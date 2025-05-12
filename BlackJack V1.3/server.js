import express from "express";
import session from "express-session";
import sharedSession from "socket.io-express-session"; // Importa el middleware

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

app.use(express.static(path.join(__dirname, 'public')))
const colors = ['red', 'blue', 'green', 'yellow'];
const games = {};
const roomColors = {};
const MAX_JUGADORES = 4;

const sessionMiddleware = session({
    secret: 'session-secret-secure', 
    resave: false,                   
    saveUninitialized: true,        
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, 
        sameSite: 'strict',          
        secure: false,               
    },
});

app.use(sessionMiddleware);
io.use(sharedSession(sessionMiddleware, {
    autoSave: true, 
}));

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
        if (!username) return socket.emit('error', 'Usuario no autenticado.');
    
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
    
        // Asignar un color a la sala si aún no tiene.
        if (!roomColors[roomId]) {
            const colorIndex = Object.keys(roomColors).length % colors.length; // Ciclar colores.
            roomColors[roomId] = colors[colorIndex];
        }
    
        // Enviar el color asignado al cliente.
        const assignedColor = roomColors[roomId];
        socket.emit('setBackground', assignedColor);
        
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


// Post para registrar usuarios en BDD
app.post('/register', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    const query = 'INSERT INTO users (username, password) VALUES (?, ?)';

    db.query(query, [username, password], (err, result) => {
        if (err) {
            console.error('Error al registrar el usuario:', err);
            return res.status(500).send('Error al registrar el usuario');
        }
        res.redirect("/login")
    });
});


// Página para el login de usuarios 
app.get('/login', (req,res)=>{

    res.render('login')
})

// Post para logear al usuario
app.post('/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    const query = 'SELECT username, password FROM users WHERE username = ? AND password = ?';

    db.query(query, [username, password], (err, result) => {
        if (err) {
            console.error('Error al encontrar el usuario:', err);
            return res.status(500).send('Error al encontrar el usuario');
        }

        if (result.length > 0) {
            req.session.username = username;

            // Redirigir al usuario a la partida si tenía una URL guardada
            const redirectTo = req.session.returnTo || "/";
            delete req.session.returnTo;  // Eliminar la variable de sesión para evitar errores futuros
            
            return res.redirect(redirectTo);
        } else {
            res.status(401).send('Usuario o contraseña incorrectos');
        }
    });
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