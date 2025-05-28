import express from "express"; // Importa el modulo de express
import session from "express-session"; // Importa las sesiones de express
import sharedSession from "socket.io-express-session"; // Importa el middleware
import bcrypt from 'bcrypt'; // Importa bcrypt para el hash de contraseñas
import { Crupier, Jugador, Partida } from './public/js/party.js'; // Importa la logica del juego.
import http from "http"; // Importa el modulo http
import { Server } from "socket.io"; // Importa el modulo socket.io
import multer from "multer";
import ejs from "ejs"; // Importa el modulo ejs
import path from "path";
import cors from "cors";
import db from "./init-db.js";
import dotenv from "dotenv";
dotenv.config();
// Inciailizacion del servidor y modulos
const app = express() 
const server = http.createServer(app); 
const io = new Server(server); 
const __dirname = path.resolve();
const upload = multer({ storage: multer.memoryStorage() });
// Configuración de EJS
app.set('appName', 'Blackjack Game');
app.set("view engine", 'ejs')
app.set('views', path.join(__dirname, '/views'));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
// Constantes de partidas
const games = {};
const MAX_JUGADORES = 4;
const MIN_PARTIDAS = 4; // Partidas iniciales mínimas
const MAX_PARTIDAS = 20; // Máximo de partidas simultáneas
const turnTimeouts = {};
// Middleware de sesión
const sessionMiddleware = session({
    secret: 'session-secret-secure', 
    resave: false,                   
    saveUninitialized: false,        
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, 
        sameSite: 'lax',    
        secure: false, 
    },
});

// Middleware de sesión para Socket.io
app.use(sessionMiddleware);

io.use(sharedSession(sessionMiddleware, {
    autoSave: false, 
}));


// Funcion para generar las partidas iniciales indicadas por {MIN_PARTIDAS}
function generarPartidasIniciales() {
    for (let i = 1; i <= MIN_PARTIDAS; i++) {
        const crupier = new Crupier();
        games[i] = new Partida([crupier], i);
    }
}
generarPartidasIniciales();

// Código para manejar la conexión de los sockets
io.on('connection', (socket) => {

// Manejo de la conexión
socket.on('joinRoom', (roomId) => {
    const username = socket.handshake.session?.username;
    if (!username) {
        console.error('Sesión no encontrada en el socket.');
        return socket.emit('error', 'Usuario no autenticado.');
    }
    
    socket.data.roomId = roomId;
    socket.data.username = username;
    let game = games[roomId];
    // Si no hay paprtida iniciada se crea una nueva y se inicia. 
    if (!game) {
        const crupier = new Crupier();
        games[roomId] = new Partida([crupier], roomId);
        game = games[roomId];
    }
    
    socket.join(roomId);
    // Verificar si el jugador ya está en la partida
    if (game.jugadores.some(player => player.nombre === username)) {
        return socket.emit('error', 'Ya estás en la partida o como espectador.');
    }

    // Emitir el estado filtrado del juego
    emitirGameStateATodos(roomId, game, io);
});

// Codigo para que el cliente pida el estado del juego.
socket.on('gameStateRequest', ({ roomId }) => {
    const game = games[roomId];
    if (!game) return socket.emit('error', 'Partida no encontrada.');

    if (game.reiniciando) {
        return socket.emit('error', 'La partida está reiniciándose, espera unos segundos.');
    }

    emitirGameStateATodos(roomId, game, io);
});
    

    
// Pedir carta
socket.on('requestCard', ({ roomId }) => {
    if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);
    const game = games[roomId];
    if (!game || game.reiniciando) return socket.emit('error', 'La partida está en proceso de reinicio.');

    const username = socket.data.username;
    const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
    if (playerIndex === -1) return socket.emit('error', 'No se encontró el jugador en la partida.');

    // CORRIGE AQUÍ:
    if (game.turnoActual !== playerIndex) return socket.emit('error', 'No es tu turno.');

    // Llamada a la funcion para pedir carta
    game.pedirCarta(playerIndex);

    // Actualizar el estado después de pedir carta
    emitirGameStateATodos(roomId, game, io);

    // Si el jugador supera los 21 puntos, cambiar de turno
    if (game.jugadores[playerIndex].puntaje > 21) {
        actualizarTurnoJuego(game, roomId);
    }
});
    
// Plantarse
socket.on('plantarse', ({ roomId }) => {
    if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);
    const game = games[roomId];
    if (!game) return;

    const username = socket.data.username;
    const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
    if (playerIndex === -1) return socket.emit('error', 'No se encontró tu jugador en la partida.');

    if (game.turnoActual !== playerIndex) return socket.emit('error', 'No es tu turno.');
    // Llamada a la funcion para plantarse
    game.plantarse(playerIndex);
    
    // Comprobas si quedan jugadores sin plantarse, si no quedan se le da el turno al crupier.
    const quedanJugadores = game.jugadores.some(j => j.tipo === "Player" && !j.plant);
    if (quedanJugadores) {
        game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
    } else {
        io.to(roomId).emit('gameEnd');
    }

    // Verificar si la ronda debe finalizar
    verificarFinalRound(roomId, game);
    // Actualizar el estado después de plantarse
    actualizarTurnoJuego(game, roomId);
    // Emitir el estado del juego filtrado
    emitirGameStateATodos(roomId, game, io);
});

// Añadir jugador
socket.on('addPlayer', async ({ roomId, username, socketId }) => {
    const game = games[roomId];

    if (!game || !username) return socket.emit('error', 'Error al unirse a la partida.');

    // Si la partida ya ha empezado, no se permite unir más jugadores.
    if (game.empezada) {
        return socket.emit('error', 'La partida ya ha comenzado y no se pueden unir más jugadores.');
    }
    // Verificar si la partida no está llena ni está empezada
    if (game.jugadores.length < MAX_JUGADORES && !game.empezada) {
        try {
            // Consulta asincrónica para obtener datos del usuario
            const [rows] = await db.query('SELECT id, dinero FROM usuarios WHERE nombre = ?', [username]);
            if (!rows.length) {
                return socket.emit('error', 'Usuario no encontrado en la base de datos.');
            }

            // Elimina cualquier jugador con el mismo nombre antes de añadirlo
            game.jugadores = game.jugadores.filter(j => j.nombre !== username);

            // Capturar toda la información del usuario de la base de datos
            const { id, dinero } = rows[0];
            const dineroInt = parseInt(dinero, 10);
            const newPlayer = new Jugador(id, username, dineroInt, socket.id);
            game.jugadores.push(newPlayer); // Usar push para añadir al final

            // --- Mueve el crupier al final si no está ---
            const crupierIndex = game.jugadores.findIndex(j => j.tipo === "Crupier");
            if (crupierIndex !== -1 && crupierIndex !== game.jugadores.length - 1) {
                const [crupier] = game.jugadores.splice(crupierIndex, 1);
                game.jugadores.push(crupier);
            }
            // --------------------------------------------

            // El turno es el primer jugador tipo Player que no esté plantado
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);

            emitirGameStateATodos(roomId, game, io);

            const jugadoresHumanos = game.jugadores.filter(jugador => jugador.tipo === "Player");
            if (jugadoresHumanos.length >= 1 && !game.empezada && !game.countDown) {
                game.countDown = true;
                let idPartida = await iniciarCuentaAtras(roomId, game, db, io);
                game.idPartida = idPartida;
            }

            emitirGameStateATodos(roomId, game, io);

        } catch (error) {
            console.error('Error al obtener usuario de la base de datos:', error);
            socket.emit('error', 'Error interno al obtener datos del usuario.');
        }
    } else {
        socket.emit('error', 'La partida está llena.');
    }
});

// Mostrar formulario de apuesta a jugadores sin apuesta
// Esta función se llama cuando la partida comienza y se envía el formulario de apuesta a los jugadores que no han apostado.
function mostrarFormularioApuesta(roomId, game, io) {
    game.jugadores.forEach(jugador => {
        if (jugador.tipo !== "Crupier" && jugador.apuesta === 0) {
            io.to(jugador.socketId).emit("mostrarFormularioApuesta");
        }
    });
}


// Realizar apuesta
socket.on('realizarApuesta', async ({ roomId, monto, fichas }) => {
    const game = games[roomId];
    if (!game) return socket.emit('error', 'Partida no encontrada.');

    const username = socket.data.username;
    const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
    if (playerIndex === -1) return socket.emit('error', 'Jugador no encontrado.');

    if (game.jugadores[playerIndex].balanceInicial === undefined) {
        game.jugadores[playerIndex].balanceInicial = game.jugadores[playerIndex].balance;
    }

    try {
        const [rows] = await db.query('SELECT dinero FROM usuarios WHERE nombre = ?', [username]);
        if (!rows.length) return socket.emit('error', 'Usuario no encontrado en la base de datos.');
        let dineroActual = parseInt(rows[0].dinero, 10);

        if (monto > dineroActual) return socket.emit('error', 'No tienes suficiente dinero para realizar esta apuesta.');

        game.jugadores[playerIndex].apuesta = monto;
        game.jugadores[playerIndex].fichasApostadas = Array.isArray(fichas) ? fichas : [];
        game.jugadores[playerIndex].balance -= monto;

        dineroActual -= monto;
        await db.execute('UPDATE usuarios SET dinero = ? WHERE nombre = ?', [dineroActual, username]);

        // --- RECALCULA EL TOTAL DE APUESTAS ---
        game.totalApuestas = game.jugadores
            .filter(j => j.tipo === "Player")
            .reduce((acc, j) => acc + (j.apuesta || 0), 0);

        socket.emit('apuestaRealizada', { balance: dineroActual });

        // Emitir el estado actualizado a todos
        emitirGameStateATodos(roomId, game, io);

        // Si la cuenta atrás de apuestas sigue activa, muestra el formulario solo a los que no han apostado
        if (game.countDown === true) {
            game.jugadores.forEach(jugador => {
                if (jugador.tipo !== "Crupier" && jugador.apuesta === 0) {
                    io.to(jugador.socketId).emit("mostrarFormularioApuesta");
                }
            });
        }

    } catch (err) {
        console.error('Error al procesar la apuesta:', err);
        socket.emit('error', { message: 'Error interno al procesar la apuesta.' });
    }
});



// Manejo de desconexión
socket.on('disconnect', async () => {
    const roomId = socket.data.roomId;
    if (!roomId || !games[roomId]) return;

    const game = games[roomId];
    const username = socket.data.username;
    if (!username) return;

    // Elimina al jugador desconectado
    game.jugadores = game.jugadores.filter(player => player.nombre !== username);

    io.to(roomId).emit('playerDisconnected', { username });

    // Si solo queda el crupier (partida base), reinicia la partida
    if (
        game.jugadores.length === 1 &&
        game.jugadores[0].tipo === 'Crupier'
    ) {
        // Reinicia la partida base (no la elimina)
        await game.reiniciar();
        game.reiniciando = false;
        emitirGameStateATodos(roomId, game, io);
    } else {
        // Si quedan más jugadores, recalcula el turno y sigue la partida
        // Si el turno actual era del jugador desconectado, pasa al siguiente
        const quedanJugadores = game.jugadores.some(j => j.tipo === "Player" && !j.plant);
        if (quedanJugadores) {
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
        }
        emitirGameStateATodos(roomId, game, io);
    }
});

    
    // Manejo de mensajes de chat.
    socket.on('chat message', ({ roomId, message, username }) => {
        io.to(roomId).emit('chat message', { username, message });
    });




/*------------------------FUNCIONES------------------------*/

async function emitirGameStateATodos(roomId, game, io) {
    const sockets = await io.in(roomId).fetchSockets();
    for (const s of sockets) {
        const user = s.data.username;
        emitirGameState(s, game, s.id, user);
    }
}
    // Función para emitir el estado del juego filtrado
async function emitirGameState(emisor, game, socketId, username) {
    const filteredGameState = game.toJSON();

    // Añade una bandera para saber si la ronda ha terminado
    filteredGameState.reiniciando = !!game.reiniciando;
    filteredGameState.countDown = !!game.countDown; // <-- AÑADE ESTA LÍNEA

    // --- NUEVO: Añadir imagenPerfil a cada jugador ---
    // Obtén los nombres de los jugadores tipo Player
    const nombresJugadores = game.jugadores
        .filter(j => j.tipo === "Player")
        .map(j => j.nombre);

    // Consulta todas las imágenes de perfil de los jugadores en una sola query
    let imagenesPerfil = {};
    if (nombresJugadores.length > 0) {
        const [rows] = await db.query(
            `SELECT nombre, imagenPerfil FROM usuarios WHERE nombre IN (${nombresJugadores.map(() => '?').join(',')})`,
            nombresJugadores
        );
        rows.forEach(row => {
            if (row.imagenPerfil) {
                imagenesPerfil[row.nombre] = `data:image/png;base64,${Buffer.from(row.imagenPerfil).toString('base64')}`;
            }
        });
    }
    // --- FIN NUEVO ---

    filteredGameState.jugadores = game.jugadores.map(jugador => {
        // Añade la imagen de perfil si es un jugador humano
        let imagenPerfil = null;
        if (jugador.tipo === "Player" && imagenesPerfil[jugador.nombre]) {
            imagenPerfil = imagenesPerfil[jugador.nombre];
        }

        // Mostrar todas las cartas y puntos si la ronda ha terminado
        if (game.reiniciando) {
            return {
                ...jugador,
                cartas: jugador.cartas,
                puntaje: jugador.puntaje,
                imagenPerfil // <-- Añade aquí
            };
        }

        // Si es el usuario actual, muestra sus cartas y puntos
        if (jugador.socketId === socketId || jugador.nombre === username) {
            return {
                ...jugador,
                cartas: jugador.cartas,
                puntaje: jugador.puntaje,
                imagenPerfil
            };
        }

        // Si es el crupier, muestra todas las cartas y el puntaje real si:
        // - la ronda ha terminado (game.reiniciando)
        // - O todos los jugadores "Player" están plantados o pasados de 21
        if (jugador.tipo === "Crupier") {
            const todosJugadoresFuera = game.jugadores
                .filter(j => j.tipo === "Player")
                .every(j => j.plant || j.puntaje > 21);

            if (game.reiniciando || todosJugadoresFuera) {
                // Mostrar todas las cartas y el puntaje real del crupier
                return {
                    ...jugador,
                    cartas: jugador.cartas,
                    puntaje: jugador.puntaje,
                    imagenPerfil: null
                };
            } else {
                // Ocultar cartas y puntaje como siempre
                return {
                    ...jugador,
                    cartas: jugador.cartas.map((carta, index) =>
                        index === 0 ? carta : { palo: "?", numero: "?", destapada: false }
                    ),
                    puntaje: "?",
                    imagenPerfil: null
                };
            }
        }

        // Para los demás jugadores, oculta cartas y puntaje
        return {
            ...jugador,
            cartas: jugador.cartas.map(() => ({ palo: "?", numero: "?", destapada: false })),
            puntaje: "?",
            imagenPerfil
        };
    });

    emisor.emit("gameState", {
        state: filteredGameState,
        turnoActual: game.turnoActual,
        currentUsername: username,
        currentSocketId: socketId
    });
}

async function iniciarCuentaAtras(roomId, game, db, io) {
    return new Promise(async (resolve, reject) => {
        try {
            io.to(roomId).emit("bloquearAcciones", true);
            io.to(roomId).emit("iniciarCuenta", 10); // Primera cuenta atrás (unirse)

            setTimeout(async () => {
                io.to(roomId).emit("iniciarCuenta", 20); // Segunda cuenta atrás (apostar)
                // 🔹 Aquí enviamos el formulario de apuesta a quienes aún no han apostado
                mostrarFormularioApuesta(roomId, game, io);

                setTimeout(async () => {
                    // 🔹 Expulsar jugadores que no apostaron
                    const jugadoresAntes = game.jugadores.length;
                    game.jugadores = game.jugadores.filter(jugador => jugador.tipo === "Crupier" || jugador.apuesta > 0);

                    if (game.jugadores.length > 1) {
                        game.empezada = true;
                        game.countDown = false;
                        io.to(roomId).emit("bloquearAcciones", false);
                        game.repartirCartas();
                        // Inicializa el turno al primer jugador activo
                        game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
                        emitirGameStateATodos(roomId, game, io); // <--- AQUÍ SÍ
                        iniciarTemporizadorTurno(roomId, game, io);

                        // --- registro en base de datos ---
                        // 🔹 **1. Insertar la partida en la tabla `Partida`**
                        const [resultadoPartida] = await db.execute(
                            `INSERT INTO partida (num_jugadores, puntos_crupier, puntos_jugador_1, puntos_jugador_2, puntos_jugador_3, ganador, bote, fecha_partida, url_partida) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
                            [
                                game.jugadores.length,
                                game.jugadores[game.jugadores.length - 1]?.puntaje ?? 0,
                                game.jugadores[0]?.puntaje ?? 0,
                                game.jugadores[1]?.puntaje ?? 0,
                                game.jugadores[2]?.puntaje ?? 0,
                                "Pendiente",
                                game.bote ?? 0,
                                ""
                            ]
                        );

                        // 🔹 Obtener el ID de la partida insertada
                        const idPartida = resultadoPartida.insertId;
                        game.idPartida = idPartida;

                        // 🔹 **2. Generar la URL única para la partida**
                        const urlPartida = `game/${roomId}`;

                        // 🔹 **3. Actualizar la tabla `Partida` para agregar la URL**
                        await db.execute(
                            `UPDATE partida SET url_partida = ? WHERE id = ?`,
                            [urlPartida, idPartida]
                        );


                        const barajaString = JSON.stringify(game.baraja);
                        await db.execute(
                            `INSERT INTO baraja (idPartida, baraja, fecha_partida) VALUES (?, ?, CURDATE())`,
                            [idPartida, barajaString]
                        );



                        // **4. Registrar cada jugador en `ParticipaEn`**
                        for (const jugador of game.jugadores.slice(0, game.jugadores.length - 1)) { // Excluye al crupier
                            await db.execute(
                                `INSERT INTO participaen (idUsuario, idPartida, puntos, estado, apuesta, ganador, fecha_partida) 
                                VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
                                [
                                    jugador.id ?? null,
                                    idPartida,
                                    jugador.puntaje ?? 0,
                                    "Jugando",
                                    jugador.apuesta ?? 0,
                                    "Pendiente"
                                ]
                            )};


                            let idCrupier;
                            const [nuevoCrupier] = await db.execute(`INSERT INTO crupier (derrotas, victorias) VALUES (0, 0)`);
                            
                            idCrupier = nuevoCrupier.insertId;
                            game.idCrupier = idCrupier;
                            // **6. Registrar el crupier en `ParticipaEnCrupier`**
                            await db.execute(
                                `INSERT INTO participaencrupier (idCrupier, idPartida, puntos, estado, ganador, fecha_partida) 
                                VALUES (?, ?, ?, ?, ?, CURDATE())`,
                                [
                                    idCrupier,
                                    idPartida,
                                    game.jugadores[game.jugadores.length - 1]?.puntaje ?? 0, // Crupier siempre es el último
                                    "Jugando",
                                    "Pendiente"
                                ]
                            );
                        resolve(idPartida);
                    } else {
                        // Si solo queda el crupier, reinicia la partida y muestra el botón de unirse
                        await game.reiniciar();
                        game.reiniciando = false;
                        game.countDown = false; // <-- Añade esto aquí también
                        emitirGameStateATodos(roomId, game, io);

                        // Notifica a los espectadores para mostrar el botón de unirse
                        const sockets = await io.in(roomId).fetchSockets();
                        for (const s of sockets) {
                            const user = s.data.username;
                            if (!game.jugadores.some(j => j.nombre === user)) {
                                socket.emit("mostrarBotonUnirse");
                            }
                        }

                        io.to(roomId).emit("error", "No se ha alcanzado el número mínimo de jugadores con apuestas. Partida cancelada.");
                        resolve(null);
                    }
                    io.to(roomId).emit("cuentaFinalizada", "La partida ha comenzado.");

                }, 20000); // Fin de la cuenta atrás para apostar
                
            }, 10000); // Fin de la cuenta atrás para unirse
        } catch (error) {
            console.error("❌ Error al registrar la partida en la base de datos:", error);
            io.to(roomId).emit("error", "Error al registrar la partida en la base de datos.");
            reject(error);
        }
    });
}
function iniciarTemporizadorTurno(roomId, game, io) {
    // Limpia cualquier timeout anterior
    if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);

    const turno = game.turnoActual;
    const jugador = game.jugadores[turno];
    if (!jugador || jugador.tipo !== "Player") return;

    // Notifica al cliente que empieza su turno
    io.to(jugador.socketId).emit("turnoIniciado", { tiempo: 20 });

    turnTimeouts[roomId] = setTimeout(() => {
        // Expulsar al jugador por inactividad
        io.to(jugador.socketId).emit("expulsadoInactividad", {
            mensaje: "Has sido expulsado por inactividad."
        });

        // Elimina al jugador de la partida
        game.jugadores = game.jugadores.filter(j => j.socketId !== jugador.socketId);

        // Emite el nuevo estado para que desaparezca de la mesa
        emitirGameStateATodos(roomId, game, io);

        // Si solo queda el crupier, reinicia la partida
        if (game.jugadores.length === 1 && game.jugadores[0].tipo === "Crupier") {
            game.reiniciar();
            game.reiniciando = false;
            emitirGameStateATodos(roomId, game, io);
        } else {
            // Avanza el turno y sigue la partida
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
            emitirGameStateATodos(roomId, game, io);
            iniciarTemporizadorTurno(roomId, game, io); // Inicia el turno del siguiente jugador
        }
    }, 20000);
}
    // Función para actualizar el turno de juego
    function actualizarTurnoJuego(game, roomId) {
        const quedanJugadores = game.jugadores.some(j => j.tipo === "Player" && !j.plant);
        if (quedanJugadores) {
            // Avanza al siguiente jugador que no esté plantado
            let siguiente = game.turnoActual;
            do {
                siguiente = (siguiente + 1) % game.jugadores.length;
            } while (
                (game.jugadores[siguiente].tipo !== "Player" || game.jugadores[siguiente].plant) &&
                siguiente !== game.turnoActual
            );
            game.turnoActual = siguiente;
            emitirGameStateATodos(roomId, game, io);
            iniciarTemporizadorTurno(roomId, game, io);
        } else {
            io.to(roomId).emit('gameEnd');
            game.jugarCrupier();
            emitirGameStateATodos(roomId, game, io);
            verificarFinalRound(roomId, game);
        }
       



}
    // Funcion para verificar si todos los jugadores han terminado su turno y si el crupier ha jugado.
    function verificarFinalRound(roomId, game) {
        if (game.reiniciando) return;

        // Considera plantados o pasados de 21 como "fuera"
        const todosFuera = game.jugadores
            .filter(jugador => jugador.tipo === "Player")
            .every(jugador => jugador.plant === true || jugador.puntaje > 21);

        if (todosFuera) {
            if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);
            game.reiniciando = true;
            io.to(roomId).emit('finalRound', { roomId });
            manejarFinalRound(roomId, games[roomId]).finally(() => {
                game.reiniciando = false;
            });
        }
    }
    async function manejarFinalRound(roomId, game) {
        game.reiniciando = true;
        emitirGameStateATodos(roomId, game, io);

        if (!game) return;
        let idPartida = game.idPartida;
        game.ganadores = game.ganadorPuntuacion();

        let idCrupier = game.idCrupier;
        let ganadoresString = game.ganadores.map(g => g.nombre).join(", ");
        try {

            // **1. Guardar estado previo
        const estadisticasPrevias = {};
        for (const jugador of game.jugadores.filter(j => j.tipo === "Player")) {
            estadisticasPrevias[jugador.nombre] = {
                apuesta: jugador.apuesta ?? 0,
                puntaje: jugador.puntaje,
                balanceInicial: jugador.balanceInicial ?? jugador.balance,
            };
        }

// 2. Repartir premios
game.distribuirPremios();

// 3. Calcular estadísticas usando los valores previos
for (const jugador of game.jugadores.filter(j => j.tipo === "Player")) {
    const prev = estadisticasPrevias[jugador.nombre];
    const apuesta = prev.apuesta;
    const balanceInicial = prev.balanceInicial;
    const gano = game.ganadores.some(g => g.nombre === jugador.nombre);
    const empate = !gano && jugador.puntaje === game.jugadores[game.jugadores.length-1].puntaje && jugador.puntaje <= 21;

    let dineroGanado = 0;
    let dineroPerdido = 0;

    if (gano) {
        dineroPerdido = apuesta;
        dineroGanado = (jugador.balance - balanceInicial) > 0
            ? jugador.balance - balanceInicial
            : apuesta;
    } else if (empate) {
        dineroPerdido = 0;
        dineroGanado = 0;
    } else {
        dineroPerdido = apuesta;
        dineroGanado = 0;
    }

    // Consulta si ya existe registro de estadísticas
    const [rows] = await db.query('SELECT * FROM estadisticasusuario WHERE idUsuario = ?', [jugador.id]);
    if (rows.length === 0) {
        // Inserta nuevo registro
        await db.execute(
            `INSERT INTO estadisticasusuario 
                (idUsuario, total_partidas, total_victorias, total_derrotas, total_dinero_ganado, total_dinero_perdido)
             VALUES (?, 1, ?, ?, ?, ?)`,
            [
                jugador.id,
                gano ? 1 : 0,
                gano ? 0 : 1,
                dineroGanado,
                dineroPerdido
            ]
        );
    } else {
        // Actualiza registro existente
        await db.execute(
            `UPDATE estadisticasusuario 
             SET 
                total_partidas = total_partidas + 1,
                total_victorias = total_victorias + ?,
                total_derrotas = total_derrotas + ?,
                total_dinero_ganado = total_dinero_ganado + ?,
                total_dinero_perdido = total_dinero_perdido + ?
             WHERE idUsuario = ?`,
            [
                gano ? 1 : 0,
                gano ? 0 : 1,
                dineroGanado,
                dineroPerdido,
                jugador.id
            ]
        );
    }
    // Actualiza el dinero del usuario en la tabla usuarios
    await db.execute(
        `UPDATE usuarios SET dinero = ? WHERE id = ?`,
        [jugador.balance, jugador.id]
    );

    // Limpia el balance inicial para la siguiente ronda
    delete jugador.balanceInicial;
}

let crupierVictoria = game.ganadores.some(g => g.nombre === "Crupier") ? 1 : 0;
let crupierDerrota = crupierVictoria === 1 ? 0 : 1;
// **3. Actualizar crupier**
const [resultadoUpdate] = await db.execute(
    `UPDATE crupier SET victorias = victorias + ?, derrotas = derrotas + ? WHERE id = ?`,
    [crupierVictoria, crupierDerrota, idCrupier]
);


await db.execute(
    `UPDATE participaencrupier SET ganador = ?, puntos = ? WHERE idCrupier = ? AND idPartida = ?`,
    [
        ganadoresString ?? "Error",
        game.jugadores[game.jugadores.length-1]?.puntaje ?? 0, // Crupier siempre es el último
        idCrupier ?? null,
        idPartida ?? null
    ]
);

const puntosJugadores = [null, null, null];
game.jugadores.filter(j => j.tipo === "Player").forEach((jugador, index) => {
    if (index < 3) puntosJugadores[index] = jugador.puntaje ?? 0; // <-- CORREGIDO
});
await db.execute(
    `UPDATE partida SET ganador = ?, puntos_crupier = ?, puntos_jugador_1 = ?, puntos_jugador_2 = ?, puntos_jugador_3 = ? WHERE id = ?`,
    [
        ganadoresString ?? "Error",
        game.jugadores[game.jugadores.length-1]?.puntaje ?? 0, // <-- CORREGIDO
        puntosJugadores[0],
        puntosJugadores[1],
        puntosJugadores[2],
        idPartida ?? null
    ]
);


        const ganadores = game.ganadores.map(g => g.nombre);
        io.to(roomId).emit("mostrarGanadores", { ganadores });
        // **6. Notificar fin de la ronda**
        io.to(roomId).emit('gameEnd');
        
        // **7. Reiniciar la partida después de unos segundos**
       setTimeout(async () => {
            await game.reiniciar();
            game.reiniciando = false; // <- Aquí se pone a false tras el reinicio
            game.countDown = false;
            emitirGameStateATodos(roomId, game, io);
            iniciarCuentaAtras(roomId, game, db, io);

            // Notificar a los espectadores para mostrar el botón de unirse
            const sockets = await io.in(roomId).fetchSockets();
            for (const s of sockets) {
                const user = s.data.username;
                // Si el usuario no está en la lista de jugadores, es espectador
                if (!game.jugadores.some(j => j.nombre === user)) {
                    socket.emit("mostrarBotonUnirse");
                }
            }
        }, 20000);

        
    } catch (error) {
        io.to(roomId).emit("error", "Hubo un problema al finalizar la partida.");
    }
}

    const usuario = socket.handshake.session?.username;
});

// Middleware para manejar CORS y JSON
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ["GET","POST"],
    credentials: true
}))
app.use(express.json())

app.use(express.urlencoded({ extended: true }));

// Middleware para establecer variables locales
app.use(async (req, res, next) => {
    res.locals.loggedIn = !!req.session.username;
    res.locals.username = req.session.username || "";
    res.locals.isAdmin = false;
    res.locals.profileImage = null;

    if (req.session.username) {
        try {
            const [rows] = await db.query("SELECT rol, imagenPerfil FROM usuarios WHERE nombre = ?", [req.session.username]);
            if (rows.length > 0) {
                res.locals.isAdmin = rows[0].rol === "Administrador";
                if (rows[0].imagenPerfil) {
                    const base64 = Buffer.from(rows[0].imagenPerfil).toString('base64');
                    res.locals.profileImage = `data:image/png;base64,${base64}`;
                } else {
                    res.locals.profileImage = null;
                }
            }
        } catch (error) {
            console.error("Error al obtener datos del usuario:", error);
        }
    }
    next();
});

// Página de inicio
app.get("/", (req, res) => {
    res.render("home"); // NO pases loggedIn ni username
});

// Página de registro
app.get('/register', (req, res) => {
    res.render('register');
});

// Página de login
app.get('/login', (req, res) => {
    res.render('login');
});

// Página de juego
app.get("/game/:id", checkAuth, (req, res) => {
    const gameId = parseInt(req.params.id, 10);
    let game = games[gameId];
    if (!game) {
        return res.redirect("/");
    }
    res.render("game", { game }); // Solo pasa game si lo necesitas
});

// Perfil de usuario
app.get('/profile/:username', checkAuth, async (req, res) => {
    const { username } = req.params;
    try {
        const results = await db.query(`
            SELECT u.id, u.nombre, u.correo, u.dinero, u.rol, u.fecha_registro, u.imagenPerfil,
                   e.total_partidas, e.total_victorias, e.total_derrotas, 
                   e.total_dinero_ganado, e.total_dinero_perdido
            FROM usuarios u
            LEFT JOIN estadisticasusuario e ON u.id = e.idUsuario
            WHERE u.nombre = ?
        `, [username]);

        if (results.length === 0 || results[0].length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const user = results[0][0];
        let profileImage = null;
        if (user.imagenPerfil) {
            const base64 = Buffer.from(user.imagenPerfil).toString('base64');
            profileImage = `data:image/png;base64,${base64}`;
        }

        res.render('profile', { 
            user,
            profileImage // <-- Añade esto
        });
    } catch (err) {
        console.error("Error al obtener perfil:", err.message);
        res.status(500).json({ error: "Hubo un problema al cargar los datos." });
    }
});

// Dashboard de admin
app.get('/dashboard', checkAuth, checkAdmin, async (req, res) => {
    try {
        const partidas = await db.query("SELECT * FROM partida ORDER BY fecha_partida DESC LIMIT 10");
        const jugadores = await db.query("SELECT id, nombre, correo, dinero, rol FROM usuarios ORDER BY nombre ASC");
        const usuarioActual = await db.query("SELECT * FROM usuarios WHERE nombre = ?", [req.session.username]);

        res.render('dashboard', { 
            partidas: partidas[0] || [], 
            jugadores: jugadores[0] || [], 
            user: usuarioActual[0][0] || null
        });
    } catch (err) {
        console.error("Error al obtener datos del dashboard:", err.message);
        res.status(500).json({ error: "Error al cargar el dashboard." });
    }
});

// Api que devuelve el listado de partidas iniciadas
app.get("/game", (req, res) => {
    res.json(Object.values(games)); // Convierte el objeto en un array y lo envía como JSON
});
// Api que devuelve la informacion de una partida en especifico
app.get("/api/game/:id", async (req, res) => {
    const gameId = req.params.id;

    // Validación de rango de IDs
    if (isNaN(gameId) || gameId > MAX_PARTIDAS || gameId < MIN_PARTIDAS) {
        return res.redirect("/");
    }

    try {
        // Busca la última baraja usada en la partida
        const [barajaRows] = await db.query(
            "SELECT baraja FROM baraja WHERE idPartida = ? ORDER BY fecha_partida DESC LIMIT 1",
            [gameId]
        );

        let baraja = [];
        if (barajaRows.length > 0) {
            try {
                baraja = JSON.parse(barajaRows[0].baraja);
            } catch (e) {
                baraja = [];
            }
        }

        // Devuelve la baraja y el id de la partida
        res.json({
            idPartida: gameId,
            baraja
        });
    } catch (err) {
        console.error("Error al obtener la baraja:", err.message);
        res.status(500).json({ error: "Error al obtener la baraja de la partida." });
    }
});


// Funcion para verificar si todas las partidas están llenas y crear una nueva si es necesario.
function checkAndOpenNewGame() {
    // Asegura que siempre haya al menos MIN_PARTIDAS partidas base
    for (let i = 1; i <= MIN_PARTIDAS; i++) {
        if (!games[i]) {
            games[i] = new Partida([new Crupier()], i);
        }
    }

    let partidasLlenasYEmpezadas = 0;
    let totalPartidas = Object.keys(games).length;

    for (let gameId in games) {
        if (games.hasOwnProperty(gameId)) {
            const game = games[gameId];
            // Considera "llena y empezada" si tiene el máximo de jugadores y está empezada
            if (game.jugadores.length >= MAX_JUGADORES && game.empezada) {
                partidasLlenasYEmpezadas++;
            }
        }
    }

    // Si todas las partidas están llenas y empezadas y no superamos el máximo, crea una nueva
    if (
        partidasLlenasYEmpezadas === totalPartidas &&
        totalPartidas < MAX_PARTIDAS
    ) {
        const currentIds = Object.keys(games).map(Number);
        const newGameId = currentIds.length > 0 ? Math.max(...currentIds) + 1 : 1;
        games[newGameId] = new Partida([new Crupier()], newGameId);
    }
}

// Verificar cada cierto tiempo si las partidas están llenas
setInterval(checkAndOpenNewGame, 5000); // Revisa cada 5 segundos

// Post para registrar un nuevo usuario
app.post('/register', upload.single('imagenPerfil'), async (req, res) => {
    let nombre = req.body.nombre;
    const correo = req.body.correo;
    const contra = req.body.contra;
    let imagenPerfil = null;
    if (req.file && req.file.buffer) {
        imagenPerfil = req.file.buffer;
    }
    let mensajeError = '';

    if (!nombre || !correo || !contra) {
        return res.json({ error: true, mensaje: 'Todos los campos son obligatorios.' });
    }

    nombre = nombre.trim().toLowerCase();

    const regexCorreo = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (nombre.length < 3) mensajeError = "El nombre debe tener al menos 3 caracteres.";
    if (!regexCorreo.test(correo)) mensajeError = "Introduce un correo electrónico válido.";
    if (contra.length < 6) mensajeError = "La contraseña debe tener al menos 6 caracteres.";

    try {
        const [rowsNombre] = await db.query('SELECT id FROM usuarios WHERE nombre = ?', [nombre]);
        if (rowsNombre.length > 0) mensajeError = 'El nombre de usuario ya está en uso.';

        const [rowsCorreo] = await db.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
        if (rowsCorreo.length > 0) mensajeError = 'El correo ya está registrado.';

        if (mensajeError) return res.json({ error: true, mensaje: mensajeError });

        const contraseñaHash = await bcrypt.hash(contra, 10);
        await db.execute(
            'INSERT INTO usuarios (nombre, correo, contraseña_Hash, dinero, rol, imagenPerfil) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre, correo, contraseñaHash, 100, "Jugador", imagenPerfil]
        );

        return res.json({ error: false, mensaje: 'Usuario registrado exitosamente.' });

    } catch(error) {
        console.error('Error al registrar el usuario:', error);
        return res.json({ error: true, mensaje: 'Error interno del servidor.' });
    }
});

// Verificar si el nombre de usuario ya existe
app.get('/verificar-nombre', async (req, res) => {
    const { nombre } = req.query;
    const [rows] = await db.query('SELECT id FROM usuarios WHERE nombre = ?', [nombre]);
    res.json({ existe: rows.length > 0 });
});
// Verificar si el correo ya existe
app.get('/verificar-correo', async (req, res) => {
    const { correo } = req.query;
    const [rows] = await db.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    res.json({ existe: rows.length > 0 });
});
// Verificar si el usuario y el correo ya existen
app.get('/verificar-usuario', async (req, res) => {
    const { correo } = req.query;
    
    const [rowsCorreo] = await db.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    const [rowsNombre] = await db.query('SELECT id FROM usuarios WHERE nombre = ?', [correo.toLowerCase()]);

    res.json({ existe: rowsCorreo.length > 0 || rowsNombre.length > 0 });
});
// Ruta de Login
app.get('/login', (req, res) => {
    res.render('login');
});
// Post para iniciar sesion
app.post('/login', async (req, res) => {
    let { correo, contraseña } = req.body;

    if (!correo || !contraseña) {
        return res.json({ error: true, mensaje: 'Todos los campos son obligatorios.' });
    }

    const regexCorreo = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!regexCorreo.test(correo) && correo.length < 3) {
        return res.json({ error: true, mensaje: 'Introduce un correo válido o un nombre de usuario válido.' });
    }

    try {
        let usuario;
        const [rowsCorreo] = await db.query('SELECT * FROM usuarios WHERE correo = ?', [correo]);
        if (rowsCorreo.length > 0) {
            usuario = rowsCorreo[0];
        } else {
            const [rowsNombre] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [correo.toLowerCase()]);
            if (rowsNombre.length > 0) {
                usuario = rowsNombre[0];
            }
        }

        if (!usuario) {
            return res.json({ error: true, mensaje: 'Usuario no encontrado. ¿Quieres <a href="/register">registrarte</a>?' });
        }

        const match = await bcrypt.compare(contraseña, usuario.contraseña_Hash);
        if (!match) {
            return res.json({ error: true, mensaje: 'Contraseña incorrecta. Inténtalo de nuevo.' });
        }

        // Almacenar datos en la sesión
        req.session.username = usuario.nombre; // Asegúrate de usar 'username' en lugar de 'usuario'

        req.session.save(err => {
            if (err) {
                console.error('Error al guardar la sesión:', err);
                return res.json({ error: true, mensaje: 'Error interno del servidor.' });
            }
            return res.json({ error: false, mensaje: `Bienvenido ${usuario.nombre}`, redirect: '/' });
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        return res.json({ error: true, mensaje: 'Error interno del servidor.' });
    }
});

// Ruta para comprobar la sesión 
app.get('/session-status', (req, res) => {
    if (req.session.usuario) {
        res.send(`Usuario en sesión: ${JSON.stringify(req.session.usuario)}`);
    } else {
        res.send('No hay usuario en la sesión.');
    }
});








app.post('/update-user', async (req, res) => {
    const { userId, dinero } = req.body; // Recibe el userId del frontend

    if (!userId) {
        return res.status(400).json({ error: "ID de usuario no proporcionado." });
    }

    try {
        await db.query("UPDATE usuarios SET dinero = ? WHERE id = ?", [dinero, userId]); // Ahora usa el ID de usuario seleccionado
        res.json({ message: "Dinero actualizado correctamente." });
    } catch (err) {
        res.status(500).json({ error: "Error al actualizar dinero." });
    }
});


app.post('/update-role', async (req, res) => {
    const { userId, rol } = req.body; // Recibe userId desde el frontend

    if (!userId) {
        return res.status(400).json({ error: "ID de usuario no proporcionado." });
    }

    try {
        await db.query("UPDATE usuarios SET rol = ? WHERE id = ?", [rol, userId]); // Modifica el usuario seleccionado
        res.json({ message: "Rol actualizado correctamente." });
    } catch (err) {
        res.status(500).json({ error: "Error al actualizar rol." });
    }
});

app.delete('/delete-user', async (req, res) => {
    const { userId } = req.body; // Ahora recibe userId correctamente

    if (!userId) {
        return res.status(400).json({ error: "ID de usuario no proporcionado." });
    }

    try {
        await db.query("DELETE FROM usuarios WHERE id = ?", [userId]); // Usa el ID del usuario
        res.json({ message: "Usuario eliminado correctamente." });
    } catch (err) {
        console.error("Error al eliminar usuario:", err.message);
        res.status(500).json({ error: "Error al eliminar usuario." });
    }
});

app.post('/create-user', async (req, res) => {
    const { nombre, correo, password, dinero, rol } = req.body;

    if (!nombre || !correo || !password) {
        return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    try {
        // Hasheamos la contraseña antes de guardarla en la base de datos
        const hashedPassword = await bcrypt.hash(password, 10);

        await db.query("INSERT INTO usuarios (nombre, correo, contraseña_hash, dinero, rol) VALUES (?, ?, ?, ?, ?)", 
                      [nombre, correo, hashedPassword, dinero || 1000, rol || "Jugador"]);

        res.json({ message: `Usuario '${nombre}' creado con éxito.` });
    } catch (err) {
        console.error("Error al crear usuario:", err.message);
        res.status(500).json({ error: "Error al crear usuario." });
    }
});


app.get('/get-info/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        let result;
        if (type === "player") {
            result = await db.query("SELECT * FROM usuarios WHERE id = ?", [id]);
        } else if (type === "game") {
            result = await db.query("SELECT * FROM partida WHERE id = ?", [id]);
        }
        res.json(result[0][0] || {});
    } catch (err) {
        console.error("Error al obtener datos:", err.message);
        res.status(500).json({ error: "Error al obtener datos." });
    }
});


app.post('/profile/update', checkAuth, upload.single('imagenPerfil'), async (req, res) => {
    const { nombre, correo } = req.body;
    const username = req.session.username;
    let imagenPerfil = null;

    // Verifica que el usuario logueado está editando su propio perfil
    if (!username || username !== req.session.username) {
        return res.status(403).json({ error: 'No tienes permiso para modificar este perfil.' });
    }

    if (req.file && req.file.buffer) {
        imagenPerfil = req.file.buffer;
    }

    try {
        if (imagenPerfil) {
            await db.query(
                'UPDATE usuarios SET nombre = ?, correo = ?, imagenPerfil = ? WHERE nombre = ?',
                [nombre, correo, imagenPerfil, username]
            );
        } else {
            await db.query(
                'UPDATE usuarios SET nombre = ?, correo = ? WHERE nombre = ?',
                [nombre, correo, username]
            );
        }
        req.session.username = nombre; // Actualiza el nombre en la sesión
        res.redirect("/")
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({ error: 'Error al actualizar perfil.' });
    }
});


// Post para cerrar sesion del usuario
app.post('/logout', checkAuth, (req, res) => {
    req.session.destroy(err => {
      if (err) {
        console.error("Error al destruir la sesión:", err);
        // Puedes manejar el error con una respuesta u otra redirección aquí
        return res.redirect('/');
      }
      res.clearCookie('connect.sid');
      res.redirect('/');
    });
  });
  



async function checkAdmin(req, res, next) {
    if (!req.session.username) {
        return res.redirect("/login");
    }
    // Consulta el usuario y su rol
    const [rows] = await db.query("SELECT rol FROM usuarios WHERE nombre = ?", [req.session.username]);
    if (!rows.length || rows[0].rol !== "Administrador") {
        return res.status(403).send("Acceso denegado: solo para administradores.");
    }
    next();
}

function checkAuth(req, res, next) {
    if (!req.session.username) {
        return res.redirect('/login');
    }
    next();
}

// Mostrar la tienda
app.get('/shop', checkAuth, (req, res) => {
    res.render('shop');
});

// Simulación de pasarela de pago
app.post('/shop/pay', checkAuth, upload.none(), async (req, res) => {
    const { coins, price, cardNumber, expiry, cvc } = req.body;
    // Validaciones básicas
    if (!coins || !price || !cardNumber || !expiry || !cvc) {
        return res.json({ error: true, mensaje: "Todos los campos son obligatorios." });
    }
    if (!/^\d{16,19}$/.test(cardNumber.replace(/\s/g, ""))) {
        return res.json({ error: true, mensaje: "Número de tarjeta inválido." });
    }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
        return res.json({ error: true, mensaje: "Fecha de caducidad inválida." });
    }
    if (!/^\d{3,4}$/.test(cvc)) {
        return res.json({ error: true, mensaje: "CVC inválido." });
    }
    // Aquí podrías simular un fallo aleatorio o comprobar saldo, etc.

    // Añadir monedas al usuario
    try {
        await db.query("UPDATE usuarios SET dinero = dinero + ? WHERE nombre = ?", [parseInt(coins, 10), req.session.username]);
        return res.json({ error: false, mensaje: "Compra realizada correctamente." });
    } catch (err) {
        return res.json({ error: true, mensaje: "Error al procesar la compra." });
    }
});



app.post('/update-name', async (req, res) => {
    const { userId, nombre } = req.body;

    if (!userId || !nombre) {
        return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    try {
        await db.query("UPDATE usuarios SET nombre = ? WHERE id = ?", [nombre, userId]);
        res.json({ message: "Nombre actualizado correctamente." });
    } catch (err) {
        console.error("Error al actualizar nombre:", err.message);
        res.status(500).json({ error: "Error al actualizar nombre." });
    }
});

app.get('/api/partida/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Info principal de la partida
        const [partidaRows] = await db.query("SELECT * FROM partida WHERE id = ?", [id]);
        const partida = partidaRows[0] || null;

        // 2. Jugadores de la partida
        const [jugadoresRows] = await db.query(`
            SELECT pe.*, u.nombre, u.correo, u.dinero, u.rol
            FROM participaen pe
            JOIN usuarios u ON pe.idUsuario = u.id
            WHERE pe.idPartida = ?
        `, [id]);

        // 3. Crupier de la partida
        const [crupierRows] = await db.query(`
            SELECT pc.*, c.*
            FROM participaencrupier pc
            LEFT JOIN crupier c ON pc.idCrupier = c.id
            WHERE pc.idPartida = ?
        `, [id]);
        const crupier = crupierRows[0] || null;

        // 4. Baraja de la partida
        const [barajaRows] = await db.query(`
            SELECT baraja FROM baraja WHERE idPartida = ? ORDER BY fecha_partida DESC LIMIT 1
        `, [id]);
        let baraja = null;
        if (barajaRows.length > 0) {
            try {
                baraja = JSON.parse(barajaRows[0].baraja);
            } catch (e) {
                baraja = barajaRows[0].baraja; // Si no es JSON, devuelve el string
            }
        }

        res.json({
            partida,
            jugadores: jugadoresRows,
            crupier,
            baraja
        });
    } catch (error) {
        console.error("Error al obtener datos de la partida:", error);
        res.status(500).json({ error: "Error al obtener los datos de la partida." });
    }
});



server.listen(PORT, '0.0.0.0', () => {
  let url;

    url = `http://localhost:${PORT}`;
  console.log(`${app.get('appName')} corriendo en: ${url}`);
});