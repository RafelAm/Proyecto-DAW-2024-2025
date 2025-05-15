import express from "express";
import session from "express-session";
import sharedSession from "socket.io-express-session"; // Importa el middleware
import bcrypt from 'bcrypt';
import { Crupier, Jugador, Partida } from './public/js/party.js';
import http from "http";
import { Server } from "socket.io";

import ejs from "ejs";
const app = express()
const server = http.createServer(app); // Crear un servidor HTTP
const io = new Server(server); // Inicializar Socket.IO

import path from "path";
import cors from "cors";
import db from "./dbConnection.js";
const __dirname = path.resolve(); // Necesario para usar __dirname en ES Modules

app.set("view engine", 'ejs')
app.set('views', path.join(__dirname, '/views'));

app.use(express.static(path.join(__dirname, 'public')));

const games = {};
const MAX_JUGADORES = 2;
const INITIAL_GAMES = 1;
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

app.use(sessionMiddleware);
io.use(sharedSession(sessionMiddleware, {
    autoSave: true, 
}));


generarDosPartidas();
function generarDosPartidas(){
        for(let i = 1; i <= INITIAL_GAMES; i++){
            const crupier = new Crupier();
            games[i] = new Partida([crupier],i);
        }
}




io.on('connection', (socket) => {
    
    function obtenerBotonesSegunUsuario(usuario) {
        if (!usuario) {
            return ['btnLogin', 'btnRegister'];
        }
        return ['btnPedirCarta', 'btnPlantarse'];
    }
    const usuario = socket.handshake.session?.username;
    const botones = obtenerBotonesSegunUsuario(usuario);
    socket.emit('mostrarBotones', botones);




    socket.on('joinRoom', (roomId) => {
        const username = socket.handshake.session?.username;
        if (!username) {
            console.error('Sesión no encontrada en el socket.');
            return socket.emit('error', 'Usuario no autenticado.');
        }
    
        socket.data.roomId = roomId;
        socket.data.username = username;
    
        let game = games[roomId];
        
        // Si no existe una partida para esta sala, crearla.
        if (!game ) {
            const crupier = new Crupier();
            games[roomId] = new Partida([crupier],roomId);
            game = games[roomId];
        }
    
        socket.join(roomId);
        
        if (game.jugadores.some(player => player.nombre === username)) {
            return socket.emit('error', 'Ya estás en la partida o como espectador.');
        }
        // Enviar el estado inicial del juego junto con el usuario actual.
        socket.emit('gameState', { 
            state: game.toJSON(),
            currentUsername: username, // 'usuario' extraído de la sesión de handshake
            turnoActual: game.turnoActual 
        });
    });

    socket.on('gameStateRequest', ({ roomId }) => {
        const game = games[roomId];
        if (!game) return socket.emit('error', 'Partida no encontrada.');
    
        if (game.reiniciando) {
            return socket.emit('error', 'La partida está reiniciándose, espera unos segundos.');
        }
    
        socket.emit('gameState', { state: game.toJSON(), turnoActual: game.turnoActual });
        socket.emit('info');
    });
    

    
    // Escuchar la acción de pedir carta.
    socket.on('requestCard', ({ roomId }) => {
        const game = games[roomId];
        if (!game || game.reiniciando) return socket.emit('error', 'La partida está en proceso de reinicio.');
        
        const username = socket.data.username;  // Recupera el usuario autenticado.
        // Buscar el índice del jugador en la partida usando el nombre de usuario.
        const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
        if (playerIndex === -1) {
            return socket.emit('error', 'No se encontró el jugador en la partida.');
        }
        game.pedirCarta(playerIndex);
        if(game.jugadores[playerIndex].puntos > 21) {
            io.to(roomId).emit('pasado', { playerIndex });
            game.siguienteTurno();
        }

        const quedanJugadores = game.jugadores.some(j => j.tipo === "Player" && !j.plant);
        if (quedanJugadores) {
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
        } else {
            io.to(roomId).emit('gameEnd');
            game.jugarCrupier(playerIndex);
        }
        // Enviar el estado actualizado del juego a todos los clientes en la sala.
        io.to(roomId).emit('gameState', { 
            state: game.toJSON(),
            turnoActual: game.turnoActual // Enviar el índice del jugador en turno
        });
        
    });
    
// Escuchar la acción de plantarse.
socket.on('plantarse', ({ roomId }) => {
    const game = games[roomId];
    if (!game) return;

    const username = socket.data.username;
    const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
    if (playerIndex === -1) {
        return socket.emit('error', 'No se encontró tu jugador en la partida.');
    }

    // El jugador se planta.
    game.plantarse(playerIndex);

    // Verificar si quedan jugadores activos antes de cambiar turno.
    const quedanJugadores = game.jugadores.some(j => j.tipo === "Player" && !j.plant);
    if (quedanJugadores) {
        // Encontrar el siguiente jugador activo
        game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
    } else {
        // Si todos los jugadores se han plantado, el crupier juega
        io.to(roomId).emit('gameEnd');
        game.jugarCrupier(playerIndex);
    }

    // Emitir el nuevo estado del juego.
    io.to(roomId).emit('gameState', { 
        state: game.toJSON(),
        turnoActual: game.turnoActual // Enviar el índice del jugador en turno.
    });

    verificarFinalRound(roomId, game);
});



    
    socket.on('pasado', ({ roomId, playerIndex }) => {
        const game = games[roomId];
        if (game) {
            game.pasado(playerIndex);
            io.to(roomId).emit('gameState', { 
                state: game.toJSON(),
                turnoActual: game.turnoActual // Enviar el índice del jugador en turno
            });
            
        }
    });
    
    socket.on('ganador', ({ roomId }) => {
        const game = games[roomId];
        if (game) {
            game.ganadorPuntuacion();
            io.to(roomId).emit('gameState', { 
                state: game.toJSON(),
                turnoActual: game.turnoActual // Enviar el índice del jugador en turno
            });
            
        }
    });
    
    socket.on('addPlayer', async ({ roomId }) => {
    const game = games[roomId];
    const username = socket.handshake.session.username;

    if (!game || !username) return socket.emit('error', 'Error al unirse a la partida.');

    if (game.jugadores.some(player => player.nombre === username)) {
        return socket.emit('error', 'Ya estás en la partida');
    }

    // Si la partida ya ha empezado, no se permite unir más jugadores.
    if (game.empezada) {
        return socket.emit('error', 'La partida ya ha comenzado y no se pueden unir más jugadores.');
    }

    if (game.jugadores.length < MAX_JUGADORES && !game.empezada) {
        try {
            // ⚠️ La consulta a la base de datos DEBE ser asincrónica
            const [rows] = await db.query('SELECT id, dinero FROM Usuarios WHERE nombre = ?', [username]);

            if (!rows.length) {
                return socket.emit('error', 'Usuario no encontrado en la base de datos.');
            }

            const { id, dinero } = rows[0];
            const dineroInt = parseInt(dinero,10)
            const newPlayer = new Jugador(id, username, dineroInt);
            game.jugadores.unshift(newPlayer);
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player");

            const jugadoresHumanos = game.jugadores.filter(jugador => jugador.tipo === "Player");
            if (jugadoresHumanos.length >= 1 && !game.empezada) {                
                game.countDown = true;
                let idPartida = await iniciarCuentaAtras(roomId, game,db);
                game.idPartida = idPartida;
            }

            io.to(roomId).emit('gameState', { state: game.toJSON(), turnoActual: game.turnoActual });

        } catch (error) {
            console.error('Error al obtener usuario de la base de datos:', error);
            socket.emit('error', 'Error interno al obtener datos del usuario.');
        }
    } else {
        socket.emit('error', 'La partida está llena.');
        maxGames++;
    }
    socket.emit('info');
});

    
// Función que inicia la cuenta regresiva de 10 segundos
async function iniciarCuentaAtras(roomId, game, db) {
        return new Promise(async (resolve, reject) => {
    // Bloquear acciones como apuestas, pedir carta, etc.
    io.to(roomId).emit("bloquearAcciones", true);
    io.to(roomId).emit("iniciarCuenta", 10); // Emitir el evento de cuenta atrás
    setTimeout(async () => {
        try {
            // Marcar la partida como empezada y desbloquear acciones
            game.empezada = true;
            
            io.to(roomId).emit("bloquearAcciones", false);
            game.repartirCartas();
            io.to(roomId).emit("gameState", { state: game.toJSON(), turnoActual: game.turnoActual });
            io.to(roomId).emit("cuentaFinalizada", "El tiempo para unirse ha finalizado.");

            // **1. Insertar la partida en la tabla `Partida`**
            const [resultadoPartida] = await db.execute(
                `INSERT INTO Partida (num_jugadores, puntos_crupier, puntos_jugador_1, puntos_jugador_2, puntos_jugador_3, ganador, bote, fecha_partida) 
                VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
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


            const idPartida = resultadoPartida.insertId; // Obtener el ID de la partida insertada
            game.idPartida = idPartida; // Guardar el ID de la partida en el objeto `game`
            
            // **2. Generar la URL única para la partida**
            const urlPartida = `game/${roomId}`;

            // **3. Actualizar la tabla `Partida` para agregar la URL**
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
                );
            }

            // **5. Obtener o registrar el crupier**
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

            console.log("✔ Registro de partida y jugadores completado.");
            console.log(`🔗 URL de la partida creada: ${urlPartida}`);
            resolve(idPartida); // Resolver la promesa con el ID de la partida
        } catch (error) {
            console.error("❌ Error al registrar la partida:", error);
            io.to(roomId).emit("error", "Error al registrar la partida en la base de datos.");
        }
    }, 10000);
    });
}

    function verificarFinalRound(roomId, game) {
        // Verificar si todos los jugadores "Player" están plantados
        const todosPlantados = game.jugadores
            .filter(jugador => jugador.tipo === "Player")
            .every(jugador => jugador.plant === true);

        if (todosPlantados) {
            console.log("🚀 Todos los jugadores están plantados");
            io.to(roomId).emit('finalRound', { roomId });
            manejarFinalRound(roomId, games[roomId]);
        }
    }
    async function manejarFinalRound(roomId, game) {
        console.log("🚀 Ejecutando manejarFinalRound");
    if (!game) return;
        let idPartida = game.idPartida;
        game.ganadores = game.ganadorPuntuacion();

        let idCrupier = game.idCrupier;
        console.log("🚀 ID del Crupier:", idCrupier);
        console.log("🚀 ID de la Partida:", idPartida);
        let ganadoresString = game.ganadores.map(g => g.nombre).join(", ");
        console.log("🚀 Ganadores:", ganadoresString);
    try {
        console.log("⚡ Ejecutando finalRound...");

        // **1. Distribuir premios**
        game.distribuirPremios();


        // **2. Actualizar balances en la base de datos**
        for (const jugador of game.jugadores.filter(j => j.tipo === "Player")) {
            jugador.balance += jugador.premio;
            await db.execute(
                `UPDATE Usuarios SET dinero = ? WHERE id = ?`,
                [jugador.balance, jugador.id]
            );

            await db.execute(
                `UPDATE ParticipaEn SET ganador = ?, puntos = ?, apuesta = ? WHERE idUsuario = ? AND idPartida = ?`,
                [
                    ganadoresString ?? "Error", // Si no está definido, usa "Pendiente"
                    jugador.puntaje ?? 0, // Si no está definido, usa 0
                    jugador.apuesta ?? 0, // Si no está definido, usa 0
                    jugador.id ?? null, // Si no está definido, usa null
                    idPartida ?? null
                ]
            );
        }
        let crupierVictoria = game.ganadores.some(g => g.nombre === "Crupier") ? 1 : 0;
        let crupierDerrota = crupierVictoria === 1 ? 0 : 1;
        console.log("✅ Crupier Victoria:", crupierVictoria);
        console.log("✅ Crupier Derrota:", crupierDerrota);
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

        // **5. Emitir estado del juego**
        io.to(roomId).emit('gameState', { state: game.toJSON(), turnoActual: game.turnoActual });

        // **6. Notificar fin de la ronda**
        io.to(roomId).emit('gameEnd');

        // **7. Reiniciar la partida después de unos segundos**
        /*setTimeout(() => {
            game.reiniciar().then(() => {
                io.to(roomId).emit('gameState', { state: game.toJSON(), turnoActual: game.turnoActual });
                io.to(roomId).emit('mostrarFormularioApuesta');
            });
        }, 20000); // Espera 20 segundos antes de reiniciar*/

        console.log("✔ FinalRound ejecutado correctamente.");
    } catch (error) {
        console.error("❌ Error al ejecutar finalRound:", error);
        io.to(roomId).emit("error", "Hubo un problema al finalizar la partida.");
    }
}

    
    socket.on('realizarApuesta', async ({ roomId, monto }) => {
    const game = games[roomId];
    if (!game) return socket.emit('error', 'Partida no encontrada.');

    const username = socket.data.username;
    const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
    if (playerIndex === -1) {
        return socket.emit('error', 'Jugador no encontrado.');
    }

    try {
        // Obtener el dinero actual del usuario
        const [rows] = await db.query('SELECT dinero FROM Usuarios WHERE nombre = ?', [username]);

        if (rows.length === 0) {
            return socket.emit('error', 'Usuario no encontrado en la base de datos.');
        }

        let dineroActual = parseInt(rows[0].dinero, 10);

        // Verificar si el usuario tiene suficiente dinero para apostar
        if (monto > dineroActual) {
            return socket.emit('error', 'No tienes suficiente dinero para realizar esta apuesta.');
        }

        // Realizar la apuesta en el juego
        game.realizarApuesta(playerIndex, monto);

        // Restar el dinero de la base de datos
        dineroActual -= monto;
        await db.execute('UPDATE Usuarios SET dinero = ? WHERE nombre = ?', [dineroActual, username]);

        // Actualizar el estado del juego y enviar respuesta al jugador
        socket.emit('apuestaRealizada', { balance: dineroActual });
        io.to(roomId).emit('gameState', { 
            state: game.toJSON(),
            turnoActual: game.turnoActual
        });

    } catch (err) {
        console.error('Error al procesar la apuesta:', err);
        socket.emit('error', { message: 'Error interno al procesar la apuesta.' });
    }
});



    socket.on('disconnect', () => {
    
        const roomId = socket.data.roomId;
        if (!roomId || !games[roomId]) return;
    
        const game = games[roomId];
        const username = socket.data.username;
        if (!username) return;
    
        // Eliminar al jugador de la partida.
        game.jugadores = game.jugadores.filter(player => player.nombre !== username);
    
        // Notificar a los demás jugadores.
        io.to(roomId).emit('playerDisconnected', { username });
    
        // Enviar el estado actualizado del juego.
        io.to(roomId).emit('gameState', { 
            state: game.toJSON(),
            turnoActual: game.turnoActual // Enviar el índice del jugador en turno
        });
        
    });
    
    // Manejo de mensajes de chat.
    socket.on('chat message', ({ roomId, message }) => {
        io.to(roomId).emit('chat message', message);
    });
});




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


app.get("/game", (req, res) => {
    res.json(Object.values(games)); // Convierte el objeto en un array y lo envía como JSON
});
app.get("/api/game/:id", (req, res) => {
    const gameId = req.params.id;
    let game = games[gameId];

    // Si la partida no existe o el ID está fuera del rango permitido
    if (!game || gameId > INITIAL_GAMES) {
        return res.redirect("/"); // Redirigir a una página de error
    }

    res.json(game);
});

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


app.get('/verificar-nombre', async (req, res) => {
    const { nombre } = req.query;
    const [rows] = await db.query('SELECT id FROM Usuarios WHERE nombre = ?', [nombre]);
    res.json({ existe: rows.length > 0 });
});

app.get('/verificar-correo', async (req, res) => {
    const { correo } = req.query;
    const [rows] = await db.query('SELECT id FROM Usuarios WHERE correo = ?', [correo]);
    res.json({ existe: rows.length > 0 });
});

app.get('/verificar-usuario', async (req, res) => {
    const { correo } = req.query;
    
    const [rowsCorreo] = await db.query('SELECT id FROM Usuarios WHERE correo = ?', [correo]);
    const [rowsNombre] = await db.query('SELECT id FROM Usuarios WHERE nombre = ?', [correo.toLowerCase()]);

    res.json({ existe: rowsCorreo.length > 0 || rowsNombre.length > 0 });
});

app.get('/login', (req, res) => {
    res.render('login', { loggedIn: !!req.session.username });
});

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

app.get('/session-status', (req, res) => {
    if (req.session.usuario) {
        res.send(`Usuario en sesión: ${JSON.stringify(req.session.usuario)}`);
    } else {
        res.send('No hay usuario en la sesión.');
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