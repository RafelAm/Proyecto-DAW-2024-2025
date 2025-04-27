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


const sessionMiddleware = session({
    secret: 'session-secret-secure', // Clave secreta para firmar la cookie de sesión
    resave: false,                   // Evita guardar la sesión si no se modifica
    saveUninitialized: true,         // No guarda sesiones vacías
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // Duración de la cookie de sesión (1 día)
        sameSite: 'strict',          // Evita el envío de cookies en solicitudes entre sitios
        secure: false,               // Cambiar a true si se usa HTTPS
    },
});

app.use(sessionMiddleware);
io.use(sharedSession(sessionMiddleware, {
    autoSave: true, // Guarda automáticamente la sesión si se modifica
}));

io.on('connection', (socket) => {
    // Función para obtener la configuración de botones según el usuario.
    function obtenerBotonesSegunUsuario(usuario) {
        // Si el usuario no está autenticado, se sugieren botones para iniciar sesión o registrarse.
        /*if (!usuario) {
            return ['btnLogin', 'btnRegister'];
        }*/
    
        // Si el usuario es 'admin', se retornan botones especiales para administración.
        if (usuario === 'admin') {
            return ['btnDashboard', 'btnCrearPartida', 'btnBorrarPartida', 'btnEditarPerfil'];
        }
    
        // Para cualquier otro usuario autenticado se retornan botones básicos.
        return ['btnPedirCarta', 'btnPlantarse'];
    }
    
    // Obtener el usuario desde la sesión del handshake.
    const usuario = socket.handshake.session?.username;
    // Determinar la configuración de botones para este usuario.
    const botones = obtenerBotonesSegunUsuario(usuario);
    // Enviar al cliente únicamente los botones que le corresponden.
    socket.emit('mostrarBotones', botones);
    
    // Escuchar la solicitud del cliente para unirse a una sala.
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
            currentUsername: usuario // 'usuario' extraído de la sesión de handshake
            
        });
    });
    
    // Escuchar la acción de pedir carta.
    socket.on('requestCard', ({ roomId }) => {
        const game = games[roomId];
        if (!game) return;
        
        const username = socket.data.username;  // Recupera el usuario autenticado.
        // Buscar el índice del jugador en la partida usando el nombre de usuario.
        const playerIndex = game.jugadores.findIndex(player => player.nombre === username);
        if (playerIndex === -1) {
            return socket.emit('error', 'No se encontró el jugador en la partida.');
        }
        
        game.pedirCarta(playerIndex, game.baraja);
        // Enviar el estado actualizado del juego a todos los clientes en la sala.
        io.to(roomId).emit('gameState', {
            state: game.toJSON()
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
        game.plantarse(playerIndex);
        io.to(roomId).emit('gameState', { state: game.toJSON() });
    
        // Verificar si todos los jugadores (excluyendo al crupier) se han plantado.
        const todosPlantados = game.jugadores
            .filter(jugador => jugador.tipo === "Player")
            .every(jugador => jugador.plant === true);
    
        if (todosPlantados) {
            io.to(roomId).emit('gameEnd');
    
            // Llamamos al método de reinicio (que espera 20 segundos) y luego se emite el nuevo estado.
            game.reiniciar().then(() => {
                io.to(roomId).emit('gameState', { state: game.toJSON() });
            });
        }
    });
    
    socket.on('pasado', ({ roomId, playerIndex }) => {
        const game = games[roomId];
        if (game) {
            game.pasado(playerIndex);
            io.to(roomId).emit('gameState', {
                state: game.toJSON()
            });
        }
    });
    
    socket.on('ganador', ({ roomId }) => {
        const game = games[roomId];
        if (game) {
            game.ganadorPuntuacion();
            io.to(roomId).emit('gameState', {
                state: game.toJSON()
            });
        }
    });
    
    socket.on('addPlayer', ({ roomId }) => {
        const game = games[roomId];
        const username = socket.handshake.session.username; // Accede a la sesión aquí
        if (!game || !username) {
            return socket.emit('error', 'Error al unirse a la partida.');
        }
    
        // Verificar si el jugador ya está en la partida
        const alreadyInGame = game.jugadores.some(player => player.nombre === username);
        if (alreadyInGame) {
            return socket.emit('error', 'Ya estás en la partida');
        }
    
        // Agregar al jugador si hay espacio.
        if (game.jugadores.length < 3 && game.empezada === false) {
            const newPlayer = new Jugador(username);
            game.jugadores.unshift(newPlayer);
            
            // Si ya hay al menos dos jugadores, se marca la partida como empezada
            if (game.jugadores.length > 1) {
                game.empezada = true;
                // Llamar a la función para repartir las cartas a todos los jugadores
                game.repartirCartas();
            }
            // Enviar el estado actualizado del juego a todos los clientes en la sala.
            io.to(roomId).emit('gameState', {
                state: game.toJSON()
            });
        } else {
            socket.emit('error', 'La partida está llena.');
        }
    });
    
    
    socket.on('disconnect', () => {
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
        io.to(roomId).emit('gameState', { state: game.toJSON() });
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
    const username = req.session.username;
    res.render("home", {username})
})


// Testing
app.get("/game/:id",(req,res)=>{
    const username = req.session.username;
    res.render("game", {username})
})


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
            console.error('Error al encontar el usuario:', err);
            return res.status(500).send('Error al encontrar el usuario');
        }
        if(result.length > 0){
            req.session.username = username;
            res.redirect("/")
        }else{
            res.status(401).send('Usuario o contraseña incorrectos');
        }
        
    });
});

// Post para cerrar sesion del usuario
app.post('/logout' , (req,res)=>{
    req.session.destroy(err => {
        console.log(err);
    })
    res.clearCookie('connect.sid')
    res.redirect('/')
})


server.listen(3000)
console.log(app.get('appName') + " http://localhost:3000")