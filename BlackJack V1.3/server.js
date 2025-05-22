import express from "express"; // Importa el modulo de express
import session from "express-session"; // Importa las sesiones de express
import sharedSession from "socket.io-express-session"; // Importa el middleware
import bcrypt from 'bcrypt'; // Importa bcrypt para el hash de contraseñas
import { Crupier, Jugador, Partida } from './public/js/party.js'; // Importa la logica del juego.
import http from "http"; // Importa el modulo http
import { Server } from "socket.io"; // Importa el modulo socket.io

import ejs from "ejs"; // Importa el modulo ejs
import path from "path";
import cors from "cors";
import db from "./dbConnection.js";

// Inciailizacion del servidor y modulos
const app = express() 
const server = http.createServer(app); 
const io = new Server(server); 
const __dirname = path.resolve();

// Configuración de EJS
app.set('appName', 'Blackjack Game');
app.set("view engine", 'ejs')
app.set('views', path.join(__dirname, '/views'));
app.use(express.static(path.join(__dirname, 'public')));

// Constantes de partidas
const games = {};
const MAX_JUGADORES = 4;
let INITIAL_GAMES = 4;

// Middleware de sesión
const sessionMiddleware = session({
    secret: 'session-secret-secure', 
    resave: false,                   
    saveUninitialized: true,        
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, 
        sameSite: 'lax',             // Cambia a 'lax' para permitir redirecciones
        secure: false,               // Asegúrate de que sea 'false' en desarrollo
    },
});
// Middleware de sesión para Socket.io
app.use(sessionMiddleware);

io.use(sharedSession(sessionMiddleware, {
    autoSave: true, 
}));


// Funcion para generar las partidas iniciales indicadas por {INITIAL_GAMES}
function generarDosPartidas(){
        for(let i = 1; i <= INITIAL_GAMES; i++){
            const crupier = new Crupier();
            games[i] = new Partida([crupier],i);
        }
}
// Inicia las partidas iniciales
generarDosPartidas();


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
    const game = games[roomId];
    if (!game || game.reiniciando) return socket.emit('error', 'La partida está en proceso de reinicio.');

    const username = socket.data.username;
    const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
    if (playerIndex === -1) return socket.emit('error', 'No se encontró el jugador en la partida.');

    if (game.turnoActual !== playerIndex) return socket.emit('error', 'No es tu turno.');

    // Llamada a la funcion para pedir carta
    game.pedirCarta(playerIndex);

    // Actualizar el estado después de pedir carta
    emitirGameStateATodos(roomId, game, io);

    // Si el jugador supera los 21 puntos, cambiar de turno sin emitir 'pasado'
    if (game.jugadores[playerIndex].puntos > 21) {
        // Cambiar el turno al siguiente jugador
        actualizarTurnoJuego(game, roomId);
    }
});
    
// Plantarse
socket.on('plantarse', ({ roomId }) => {
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
        game.jugarCrupier(playerIndex);
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
            const [rows] = await db.query('SELECT id, dinero FROM Usuarios WHERE nombre = ?', [username]);
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
        INITIAL_GAMES++;
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

    try {
        // Obtener el dinero actual del usuario de forma segura
        const [rows] = await db.query('SELECT dinero FROM Usuarios WHERE nombre = ?', [username]);
        if (!rows.length) return socket.emit('error', 'Usuario no encontrado en la base de datos.');
        let dineroActual = parseInt(rows[0].dinero, 10);

        if (monto > dineroActual) return socket.emit('error', 'No tienes suficiente dinero para realizar esta apuesta.');

        // Registrar la apuesta y el desglose de fichas
        game.jugadores[playerIndex].apuesta = monto;
        game.jugadores[playerIndex].fichasApostadas = Array.isArray(fichas) ? fichas : [];

        // Restar el dinero del usuario en la base de datos
        dineroActual -= monto;
        await db.execute('UPDATE Usuarios SET dinero = ? WHERE nombre = ?', [dineroActual, username]);

        socket.emit('apuestaRealizada', { balance: dineroActual });

        emitirGameStateATodos(roomId, game, io);

    } catch (err) {
        console.error('Error al procesar la apuesta:', err);
        socket.emit('error', { message: 'Error interno al procesar la apuesta.' });
    }
});



// Manejo de desconexión
socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !games[roomId]) return;

    const game = games[roomId];
    const username = socket.data.username;
    if (!username) return;

    game.jugadores = game.jugadores.filter(player => player.nombre !== username);

    io.to(roomId).emit('playerDisconnected', { username });

    if (game.jugadores.length === 1 && game.jugadores[0].tipo === 'Crupier') {
        delete games[roomId];
        io.to(roomId).emit('gameEnd');
    } else {
            emitirGameStateATodos(roomId, game, io);
    }
});

    
    // Manejo de mensajes de chat.
    socket.on('chat message', ({ roomId, message }) => {
        io.to(roomId).emit('chat message', message);
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
function emitirGameState(emisor, game, socketId, username) {
    const filteredGameState = game.toJSON();

    filteredGameState.jugadores = game.jugadores.map(jugador => ({
        nombre: jugador.nombre,
        tipo: jugador.tipo,
        socketId: jugador.socketId || null,
        apuesta: jugador.apuesta,
        fichasApostadas: jugador.fichasApostadas || [],
        cartas: jugador.cartas.map((carta, index) => {
            // Si el jugador actual coincide con el socket ID, muestra sus cartas
            if (jugador.socketId === socketId || jugador.nombre === username) {
                return carta;
            }
            // Si el crupier, solo muestra la primera carta
            else if (jugador.tipo === "Crupier" && index === 0) {
                return carta;
            }
            // Oculta las cartas de los demás jugadores
            else {
                return { palo: "?", numero: "?", destapada: false };
            }
        })
    }));

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
                    game.jugadores = game.jugadores.filter(jugador => jugador.tipo === "Crupier" || jugador.apuesta > 0);

                    if (game.jugadores.length > 1) {
                        game.empezada = true;
                        io.to(roomId).emit("bloquearAcciones", false);
                        game.repartirCartas();
                        emitirGameState(io.to(roomId), game, socket.id, game.currentUsername);

                        // 🔹 **1. Insertar la partida en la tabla `Partida`**
                        const [resultadoPartida] = await db.execute(
                            `INSERT INTO Partida (num_jugadores, puntos_crupier, puntos_jugador_1, puntos_jugador_2, puntos_jugador_3, ganador, bote, fecha_partida) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                            [
                                game.jugadores.length,
                                game.jugadores[game.jugadores.length - 1]?.puntos ?? 0, // Crupier (último jugador)
                                game.jugadores[0]?.puntos ?? 0, // Primer jugador (si existe)
                                game.jugadores[1]?.puntos ?? 0, // Segundo jugador (si existe)
                                game.jugadores[2]?.puntos ?? 0, // Tercer jugador (si existe)
                                "Pendiente", // Se actualizará al final
                                game.bote ?? 0
                            ]
                        );

                        // 🔹 Obtener el ID de la partida insertada
                        const idPartida = resultadoPartida.insertId;
                        game.idPartida = idPartida;

                        // 🔹 **2. Generar la URL única para la partida**
                        const urlPartida = `game/${roomId}`;

                        // 🔹 **3. Actualizar la tabla `Partida` para agregar la URL**
                        await db.execute(
                            `UPDATE Partida SET url_partida = ? WHERE id = ?`,
                            [urlPartida, idPartida]
                        );


                        const barajaString = JSON.stringify(game.baraja);
                        await db.execute(
                            `INSERT INTO Baraja (idPartida, baraja, fecha_partida) VALUES (?, ?, CURDATE())`,
                            [idPartida, barajaString]
                        );



                        // **4. Registrar cada jugador en `ParticipaEn`**
                        for (const jugador of game.jugadores.slice(0, game.jugadores.length - 1)) { // Excluye al crupier
                            await db.execute(
                                `INSERT INTO ParticipaEn (idUsuario, idPartida, puntos, estado, apuesta, ganador, fecha_partida) 
                                VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
                                [
                                    jugador.id ?? null,
                                    idPartida,
                                    jugador.puntos ?? 0,
                                    "Jugando",
                                    jugador.apuesta ?? 0,
                                    "Pendiente"
                                ]
                            )};


                            let idCrupier;
                            const [nuevoCrupier] = await db.execute(`INSERT INTO Crupier (derrotas, victorias) VALUES (0, 0)`);
                            
                            idCrupier = nuevoCrupier.insertId;
                            game.idCrupier = idCrupier;
                            // **6. Registrar el crupier en `ParticipaEnCrupier`**
                            await db.execute(
                                `INSERT INTO ParticipaEnCrupier (idCrupier, idPartida, puntos, estado, ganador, fecha_partida) 
                                VALUES (?, ?, ?, ?, ?, CURDATE())`,
                                [
                                    idCrupier,
                                    idPartida,
                                    game.jugadores[game.jugadores.length - 1]?.puntos ?? 0, // Crupier siempre es el último
                                    "Jugando",
                                    "Pendiente"
                                ]
                            );
                        resolve(idPartida);
                    } else {
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
        emitirGameStateATodos(roomId, game, io);    
}

    // Función para actualizar el turno de juego
    function actualizarTurnoJuego(game, roomId) {
        const quedanJugadores = game.jugadores.some(j => j.tipo === "Player" && !j.plant);
        if (quedanJugadores) {
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
        } else {
            io.to(roomId).emit('gameEnd');
            game.jugarCrupier(game.turnoActual);
        }
        verificarFinalRound(roomId, game);
        emitirGameStateATodos(roomId, game, io);    
}
    // Funcion para verificar si todos los jugadores han terminado su turno y si el crupier ha jugado.
    function verificarFinalRound(roomId, game) {
        // Evita dobles ejecuciones
        if (game.reiniciando) return;
        // Verificar si todos los jugadores "Player" están plantados
        const todosPlantados = game.jugadores
            .filter(jugador => jugador.tipo === "Player")
            .every(jugador => jugador.plant === true);

        if (todosPlantados) {
            game.reiniciando = true; // Marca que está finalizando
            io.to(roomId).emit('finalRound', { roomId });
            manejarFinalRound(roomId, games[roomId]).finally(() => {
                game.reiniciando = false; // Libera la bandera al terminar
            });
        }
    }
    async function manejarFinalRound(roomId, game) {
        
        let test = socket.handshake.session?.username;
        console.log("Usuario actual - vfinal:", test);
    if (!game) return;
        let idPartida = game.idPartida;
        game.ganadores = game.ganadorPuntuacion();

        let idCrupier = game.idCrupier;
        let ganadoresString = game.ganadores.map(g => g.nombre).join(", ");
    try {

        // **1. Distribuir premios**
        game.distribuirPremios();

        // **2. Actualizar balances en la base de datos**
        for (const jugador of game.jugadores.filter(j => j.tipo === "Player")) {
            // NO sumar jugador.premio aquí
            await db.execute(
                `UPDATE Usuarios SET dinero = ? WHERE id = ?`,
                [jugador.balance, jugador.id]
            );

            await db.execute(
                `UPDATE ParticipaEn SET ganador = ?, puntos = ?, apuesta = ? WHERE idUsuario = ? AND idPartida = ?`,
                [
                    ganadoresString ?? "Error",
                    jugador.puntaje ?? 0,
                    jugador.apuesta ?? 0,
                    jugador.id ?? null,
                    idPartida ?? null
                ]
            );
        }
        let crupierVictoria = game.ganadores.some(g => g.nombre === "Crupier") ? 1 : 0;
        let crupierDerrota = crupierVictoria === 1 ? 0 : 1;
        // **3. Actualizar crupier**
        const [resultadoUpdate] = await db.execute(
            `UPDATE Crupier SET victorias = victorias + ?, derrotas = derrotas + ? WHERE id = ?`,
            [crupierVictoria, crupierDerrota, idCrupier]
        );



        await db.execute(
            `UPDATE ParticipaEnCrupier SET ganador = ?, puntos = ? WHERE idCrupier = ? AND idPartida = ?`,
            [
                ganadoresString ?? "Error",
                game.jugadores[game.jugadores.length-1]?.puntaje ?? 0,
                idCrupier ?? null,
                idPartida ?? null
            ]
        );
        const puntosJugadores = [null, null, null]; // Inicializa con valores vacíos

        // Asigna valores solo a los jugadores existentes
        game.jugadores.filter(j => j.tipo === "Player").forEach((jugador, index) => {
            if (index < 3) puntosJugadores[index] = jugador.puntaje ?? 0;
        });
        // **4. Actualizar la partida**
        await db.execute(
            `UPDATE Partida SET ganador = ?, puntos_crupier = ?, puntos_jugador_1 = ?, puntos_jugador_2 = ?, puntos_jugador_3 = ? WHERE id = ?`,
            [
                ganadoresString ?? "Error",
                game.jugadores[game.jugadores.length-1]?.puntaje ?? 0,
                puntosJugadores[0], // Jugador 1
                puntosJugadores[1], // Jugador 2
                puntosJugadores[2], // Jugador 3
                idPartida ?? null
            ]
        );

        

        // **6. Notificar fin de la ronda**
        io.to(roomId).emit('gameEnd');

        // **7. Reiniciar la partida después de unos segundos**
        setTimeout(async () => {
            await game.reiniciar();
            emitirGameStateATodos(roomId, game, io);
            iniciarCuentaAtras(roomId, game, db, io);

            // Notificar a los espectadores para mostrar el botón de unirse
            const sockets = await io.in(roomId).fetchSockets();
            for (const s of sockets) {
                const user = s.data.username;
                // Si el usuario no está en la lista de jugadores, es espectador
                if (!game.jugadores.some(j => j.nombre === user)) {
                    s.emit("mostrarBotonUnirse");
                }
            }
        }, 20000);

        
    } catch (error) {
        io.to(roomId).emit("error", "Hubo un problema al finalizar la partida.");
    }
}
    // Mostrar botones según el estado de la sesión
    function obtenerBotonesSegunUsuario(usuario) {
        if (!usuario) {
            return ['btnLogin', 'btnRegister'];
        }
        return ['btnPedirCarta', 'btnPlantarse'];
    }
    const usuario = socket.handshake.session?.username;
    const botones = obtenerBotonesSegunUsuario(usuario);
    socket.emit('mostrarBotones', botones);
});

// Middleware para manejar CORS y JSON
app.use(cors({
    origin: ['localhost:3000', '127.0.0.1:3000'],
    credentials: true
}))
app.use(express.json())

app.use(express.urlencoded({ extended: true }));


// Página de incio
app.get("/", (req,res)=>{
    res.render("home", {loggedIn: !!req.session.username })
})


// Middleware para verificar si el usuario está autenticado.
function checkAuth(req, res, next) {
    res.locals.loggedIn = !!req.session.username; // Variable accesible desde las vistas
    if (!req.session.username) {
        req.session.returnTo = req.originalUrl;  // Guardar la URL original
        return res.redirect("/login");
    }
    next();
}
app.use((req, res, next) => {
    res.locals.loggedIn = !!req.session.username; // Definir la variable para todas las vistas
    next();
});
  
  // Ruta protegida usando el middleware.
app.get("/game/:id", checkAuth, (req, res) => {
    const gameId = parseInt(req.params.id, 10);
    let game = games[gameId];

    // Verificar si la partida solicitada existe
    if (!game) {
        return res.redirect("/");
    }

    res.render("game", { loggedIn: !!req.session.username, game });
});

// Api que devuelve el listado de partidas iniciadas
app.get("/game", (req, res) => {
    res.json(Object.values(games)); // Convierte el objeto en un array y lo envía como JSON
});
// Api que devuelve la informacion de una partida en especifico
app.get("/api/game/:id", (req, res) => {
    const gameId = req.params.id;
    let game = games[gameId];

    // Si la partida no existe o el ID está fuera del rango permitido
    if (!game || gameId > INITIAL_GAMES) {
        return res.redirect("/"); // Redirigir a una página de error
    }

    res.json(game);
});


// Funcion para verificar si todas las partidas están llenas y crear una nueva si es necesario.
function checkAndOpenNewGame() {
    // Recorre todas las partidas existentes para saber si alguna tiene espacio.
    let allFull = true;
    for (let gameId in games) {
        if (games.hasOwnProperty(gameId)) {
            // Si alguna partida tiene menos de la cantidad máxima de jugadores, detenemos la función.
            if (games[gameId].jugadores.length < MAX_JUGADORES) {
                allFull = false;
                break;
            }
        }
    }

    // Si todas las partidas están llenas, se crea una nueva partida.
    if (allFull) {
        // Calcula el nuevo ID: el máximo ID existente + 1
        const currentIds = Object.keys(games).map(Number);
        const newGameId = currentIds.length > 0 ? Math.max(...currentIds) + 1 : 1;
        games[newGameId] = new Partida([new Crupier()], newGameId);
        console.log(`¡Nueva partida creada! ID: /game/${newGameId}`);
    }
}

// Verificar cada cierto tiempo si las partidas están llenas
setInterval(checkAndOpenNewGame, 5000); // Revisa cada 5 segundos

// Página para el registro de usuarios
app.get('/register', (req,res)=>{

    res.render('register', { loggedIn: !!req.session.username })
})

// Post para registrar un nuevo usuario
app.post('/register', async (req, res) => {
    let { nombre, correo, contraseña } = req.body;
    let mensajeError = '';
    
    if (!nombre || !correo || !contraseña) {
        return res.json({ error: true, mensaje: 'Todos los campos son obligatorios.' });
    }

    // Convertir el nombre a minúsculas
    nombre = nombre.trim().toLowerCase();
    
    // Expresión regular para validar correos electrónicos
    const regexCorreo = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (nombre.length < 3) mensajeError = "El nombre debe tener al menos 3 caracteres.";
    if (!regexCorreo.test(correo)) mensajeError = "Introduce un correo electrónico válido.";
    if (contraseña.length < 6) mensajeError = "La contraseña debe tener al menos 6 caracteres.";

    try {
        const [rowsNombre] = await db.query('SELECT id FROM Usuarios WHERE nombre = ?', [nombre]);
        if (rowsNombre.length > 0) mensajeError = 'El nombre de usuario ya está en uso.';

        const [rowsCorreo] = await db.query('SELECT id FROM Usuarios WHERE correo = ?', [correo]);
        if (rowsCorreo.length > 0) mensajeError = 'El correo ya está registrado.';

        if (mensajeError) return res.json({ error: true, mensaje: mensajeError });

        const contraseñaHash = await bcrypt.hash(contraseña, 10);
        await db.execute('INSERT INTO Usuarios (nombre, correo, contraseña_Hash, dinero, rol) VALUES (?, ?, ?, ?, ?)',
                         [nombre, correo, contraseñaHash, 100, "Jugador"]);

        return res.json({ error: false, mensaje: 'Usuario registrado exitosamente.' });

    } catch (error) {
        console.error('Error al registrar el usuario:', error);
        return res.json({ error: true, mensaje: 'Error interno del servidor.' });
    }
});

// Verificar si el nombre de usuario ya existe
app.get('/verificar-nombre', async (req, res) => {
    const { nombre } = req.query;
    const [rows] = await db.query('SELECT id FROM Usuarios WHERE nombre = ?', [nombre]);
    res.json({ existe: rows.length > 0 });
});
// Verificar si el correo ya existe
app.get('/verificar-correo', async (req, res) => {
    const { correo } = req.query;
    const [rows] = await db.query('SELECT id FROM Usuarios WHERE correo = ?', [correo]);
    res.json({ existe: rows.length > 0 });
});
// Verificar si el usuario y el correo ya existen
app.get('/verificar-usuario', async (req, res) => {
    const { correo } = req.query;
    
    const [rowsCorreo] = await db.query('SELECT id FROM Usuarios WHERE correo = ?', [correo]);
    const [rowsNombre] = await db.query('SELECT id FROM Usuarios WHERE nombre = ?', [correo.toLowerCase()]);

    res.json({ existe: rowsCorreo.length > 0 || rowsNombre.length > 0 });
});
// Ruta de Login
app.get('/login', (req, res) => {
    res.render('login', { loggedIn: !!req.session.username });
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
        const [rowsCorreo] = await db.query('SELECT * FROM Usuarios WHERE correo = ?', [correo]);
        if (rowsCorreo.length > 0) {
            usuario = rowsCorreo[0];
        } else {
            const [rowsNombre] = await db.query('SELECT * FROM Usuarios WHERE nombre = ?', [correo.toLowerCase()]);
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
            console.log('Sesión después del login:', req.session);
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


// Consultar usuario por nombre
app.get('/profile/:username', checkAuth, async (req, res) => {
    const { username } = req.params;

    try {
        const results = await db.query(`
            SELECT u.id, u.nombre, u.correo, u.dinero, u.rol, u.fecha_registro, 
                   e.total_partidas, e.total_victorias, e.total_derrotas, 
                   e.total_dinero_ganado, e.total_dinero_perdido
            FROM Usuarios u
            LEFT JOIN EstadisticasUsuario e ON u.id = e.idUsuario
            WHERE u.nombre = ?
        `, [username]);

        if (results.length === 0 || results[0].length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.render('profile', { 
            user: results[0][0], 
            loggedIn: !!req.session.username, 
            sessionUser: req.session.username 
        });
    } catch (err) {
        console.error("Error al obtener perfil:", err.message);
        res.status(500).json({ error: "Hubo un problema al cargar los datos." });
    }
});

app.get('/dashboard', checkAuth, async (req, res) => {
    try {
        const partidas = await db.query("SELECT * FROM Partida ORDER BY fecha_partida DESC LIMIT 10");
        const jugadores = await db.query("SELECT id, nombre, correo, dinero, rol FROM Usuarios ORDER BY nombre ASC");

        // Obtiene el usuario actual en sesión
        const usuarioActual = await db.query("SELECT * FROM Usuarios WHERE nombre = ?", [req.session.username]);

        res.render('dashboard', { 
            partidas: partidas[0] || [], 
            jugadores: jugadores[0] || [], 
            user: usuarioActual[0][0] || null // Pasamos `user` correctamente
        });
    } catch (err) {
        console.error("Error al obtener datos del dashboard:", err.message);
        res.status(500).json({ error: "Error al cargar el dashboard." });
    }
});


app.post('/update-user', async (req, res) => {
    const { userId, dinero } = req.body; // Recibe el userId del frontend

    if (!userId) {
        return res.status(400).json({ error: "ID de usuario no proporcionado." });
    }

    try {
        await db.query("UPDATE Usuarios SET dinero = ? WHERE id = ?", [dinero, userId]); // Ahora usa el ID de usuario seleccionado
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
        await db.query("UPDATE Usuarios SET rol = ? WHERE id = ?", [rol, userId]); // Modifica el usuario seleccionado
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
        await db.query("DELETE FROM Usuarios WHERE id = ?", [userId]); // Usa el ID del usuario
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

        await db.query("INSERT INTO Usuarios (nombre, correo, contraseña_hash, dinero, rol) VALUES (?, ?, ?, ?, ?)", 
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
            result = await db.query("SELECT * FROM Usuarios WHERE id = ?", [id]);
        } else if (type === "game") {
            result = await db.query("SELECT * FROM Partida WHERE id = ?", [id]);
        }
        res.json(result[0][0] || {});
    } catch (err) {
        console.error("Error al obtener datos:", err.message);
        res.status(500).json({ error: "Error al obtener datos." });
    }
});


app.post('/profile/update', checkAuth, async (req, res) => {
    const { nombre, correo } = req.body;
    const username = req.session.username;

    // Verifica que el usuario logueado está editando su propio perfil
    if (!username || username !== req.session.username) {
        return res.status(403).json({ error: 'No tienes permiso para modificar este perfil.' });
    }

    try {
        await db.query('UPDATE usuarios SET nombre = ?, correo = ? WHERE nombre = ?', [nombre, correo, username]);
        req.session.username = nombre;  // Actualiza la sesión con el nuevo nombre
        res.redirect(`/profile/${nombre}`);
    } catch (err) {
        console.error("Error al actualizar perfil:", err.message);
        res.status(500).json({ error: "Hubo un problema al actualizar los datos." });
    }
});



app.get('/get-user/:id', async (req, res) => {
    try {
        const user = await db.query("SELECT * FROM Usuarios WHERE id = ?", [req.params.id]);
        res.json(user[0][0] || {});
    } catch (err) {
        console.error("Error al obtener usuario:", err.message);
        res.status(500).json({ error: "Error al obtener usuario." });
    }
});

app.get('/get-info/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    try {
        let result;
        if (type === "player") {
            result = await db.query("SELECT * FROM Usuarios WHERE id = ?", [id]);
        } else if (type === "game") {
            result = await db.query(`
                SELECT p.*, b.baraja 
                FROM Partida p
                LEFT JOIN Baraja b ON p.id = b.idPartida
                WHERE p.id = ?
            `, [id]);
        }
        res.json(result[0][0] || {});
    } catch (err) {
        console.error("Error al obtener datos:", err.message);
        res.status(500).json({ error: "Error al obtener datos." });
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
  

server.listen(3000)
console.log(app.get('appName') + " http://localhost:3000")