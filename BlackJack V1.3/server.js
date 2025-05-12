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
const MAX_JUGADORES = 4;

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

io.on('connection', (socket) => {
    console.log('Sesión en Socket.IO:', socket.handshake.session);
    
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
        if (!game) {
            const crupier = new Crupier();
            games[roomId] = new Partida([crupier]);
            game = games[roomId];
        }
    
        socket.join(roomId);
        
        // Enviar el estado inicial del juego junto con el usuario actual.
        socket.emit('gameState', { 
            state: game.toJSON(),
            currentUsername: usuario, // 'usuario' extraído de la sesión de handshake
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

    // Verificar si todos los jugadores (excluyendo al crupier) se han plantado.
    const todosPlantados = game.jugadores
        .filter(jugador => jugador.tipo === "Player")
        .every(jugador => jugador.plant);

    if (todosPlantados) {
        io.to(roomId).emit('gameEnd');

        // Llamamos al método de reinicio (espera 20 segundos) y luego se emite el nuevo estado.
        game.reiniciar().then(() => {
            io.to(roomId).emit('gameState', { 
                state: game.toJSON(),
                turnoActual: game.turnoActual // Enviar el índice del jugador en turno.
            });
        });
    }
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
    
    socket.on('addPlayer', ({ roomId }) => {
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
            const newPlayer = new Jugador(username);
            game.jugadores.unshift(newPlayer);
            game.turnoActual = game.jugadores.findIndex(j => j.tipo === "Player");
            const jugadoresHumanos = game.jugadores.filter(jugador => jugador.tipo === "Player");
            if (jugadoresHumanos.length >= 2 && !game.empezada) {                
                game.countDown = true;
                iniciarCuentaAtras(roomId, game);
            }

    
            io.to(roomId).emit('gameState', { state: game.toJSON(), turnoActual: game.turnoActual });
        } else {
            socket.emit('error', 'La partida está llena.');
        }
    });
    
// Función que inicia la cuenta regresiva de 10 segundos
function iniciarCuentaAtras(roomId, game) {
    // Bloquear las acciones: apuestas, pedir carta, plantarse, etc.
    io.to(roomId).emit("bloquearAcciones", true);
    
    // Emitir el evento que inicia el contador con 10 segundos
    io.to(roomId).emit("iniciarCuenta", 10);
  
    // Inicia el temporizador de 10 segundos
    setTimeout(() => {
      // Marcar la partida como empezada y desbloquear las acciones
      game.empezada = true;
      io.to(roomId).emit("bloquearAcciones", false);
      game.repartirCartas();
      io.to(roomId).emit("gameState", { 
        state: game.toJSON(), 
        turnoActual: game.turnoActual 
      });
      // Emite un mensaje que indica que se ha pasado el tiempo para unirse
      io.to(roomId).emit("cuentaFinalizada", "El tiempo para unirse ha finalizado.");
    }, 10000);
  }
    
    socket.on('finalRound', ({ roomId }) => {
        const game = games[roomId];
        if (!game) return;
    
        // Verificar si todos los jugadores de tipo "Player" están plantados
        const todosPlantados = game.jugadores
            .filter(jugador => jugador.tipo === "Player")
            .every(jugador => jugador.plant === true);
    
        if (!todosPlantados) {
            return socket.emit('error', 'No todos los jugadores han finalizado su turno.');
        }

        // Distribuir premios con base en las reglas definidas
        game.distribuirPremios();
    
        // Emitir el estado actualizado del juego (balances, puntajes, etc.)
        io.to(roomId).emit('gameState', { 
            state: game.toJSON(),
            turnoActual: game.turnoActual // Enviar el índice del jugador en turno
        });
        
    
        // Notificar el final de la ronda
        io.to(roomId).emit('gameEnd');
    
        try {
            game.reiniciar();  // ✅ Esperamos que termine la reinicialización
    
            io.to(roomId).emit('gameState', { 
                state: game.toJSON(), 
                turnoActual: game.turnoActual 
            });
    
            io.to(roomId).emit('mostrarFormularioApuesta');
        } catch (error) {
            console.error("Error al reiniciar la partida:", error);
            socket.emit('error', 'Hubo un problema al reiniciar la partida.');
        }
    });
    
    
    socket.on('realizarApuesta', ({ roomId, monto }) => {
        const game = games[roomId];
        if (!game) return socket.emit('error', 'Partida no encontrada.');
    
        const username = socket.data.username;
        const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
        if (playerIndex === -1) {
            return socket.emit('error', 'Jugador no encontrado.');
        }
    
        try {
            game.realizarApuesta(playerIndex, monto);
            socket.emit('apuestaRealizada', { balance: game.jugadores[playerIndex].balance });
    
            // Enviar el estado actualizado solo **una vez**
            io.to(roomId).emit('gameState', { 
                state: game.toJSON(),
                turnoActual: game.turnoActual // Enviar el índice del jugador en turno
            });
            
    
        } catch (err) {
            socket.emit('error', { message: err.message });
        }
    });
    


    /*socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.handshake.session.username);
    
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
        
    });*/
    
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
    const username = req.session.username;
    res.render("home", {username})
})


// Middleware para verificar si el usuario está autenticado.
function checkAuth(req, res, next) {
    console.log('Sesión en checkAuth:', req.session);
    if (!req.session.username) {
        req.session.returnTo = req.originalUrl;  // Guardar la URL original
        return res.redirect("/login");
    }
    next();
}

  
  // Ruta protegida usando el middleware.
  app.get("/game/:id", checkAuth, (req, res) => {
    res.render("game", { username: req.session.username });
  });
  


// Página para el registro de usuarios
app.get('/register', (req,res)=>{

    res.render('register')
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
    res.render('login');
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