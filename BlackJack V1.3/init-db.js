import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

// Usa 'db' solo si está en Docker, si no, usa 'localhost'
const dbHost = process.env.DB_HOST || "localhost";

const db = await mysql.createConnection({
  host: dbHost,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: 3306
});

console.log('Conectado a MySQL.');

// 🔹 Crear la base de datos si no existe
await db.query(`CREATE DATABASE IF NOT EXISTS blackjackdb`);
await db.changeUser({ database: 'blackjackdb' });

console.log('Base de datos creada o ya existente.');

// 🔹 Lista de consultas para la creación de tablas
const queries = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL UNIQUE,
    correo VARCHAR(255) NOT NULL UNIQUE,
    contraseña_Hash VARCHAR(255) NOT NULL,
    dinero DECIMAL(10,2) NOT NULL DEFAULT 100.00,
    rol VARCHAR(50) NOT NULL,
    imagenPerfil LONGBLOB DEFAULT NULL,
    fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS partida (
    id INT AUTO_INCREMENT PRIMARY KEY,
    num_jugadores INT NOT NULL,
    puntos_crupier INT NOT NULL,
    puntos_jugador_1 INT DEFAULT 0,
    puntos_jugador_2 INT DEFAULT 0,
    puntos_jugador_3 INT DEFAULT 0,
    ganador VARCHAR(255) NOT NULL,
    bote DECIMAL(10,2) NOT NULL,
    fecha_partida DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    url_partida VARCHAR(255) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS crupier (
    id INT AUTO_INCREMENT PRIMARY KEY,
    derrotas INT NOT NULL DEFAULT 0,
    victorias INT NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS participaencrupier (
    idCrupier INT NOT NULL,
    idPartida INT NOT NULL,
    puntos INT NOT NULL,
    estado VARCHAR(255) NOT NULL,
    ganador VARCHAR(255) NOT NULL,
    fecha_partida DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (idCrupier, idPartida),
    FOREIGN KEY (idCrupier) REFERENCES crupier(id),
    FOREIGN KEY (idPartida) REFERENCES partida(id)
  )`,

  `CREATE TABLE IF NOT EXISTS participaen (
    idUsuario INT NOT NULL,
    idPartida INT NOT NULL,
    puntos INT NOT NULL,
    estado VARCHAR(255) NOT NULL,
    apuesta DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ganador VARCHAR(255) NOT NULL,
    fecha_partida DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (idUsuario, idPartida),
    FOREIGN KEY (idUsuario) REFERENCES usuarios(id),
    FOREIGN KEY (idPartida) REFERENCES partida(id)
  )`,

  `CREATE TABLE IF NOT EXISTS estadisticasusuario (
    idUsuario INT NOT NULL PRIMARY KEY,
    total_partidas INT NOT NULL DEFAULT 0,
    total_victorias INT NOT NULL DEFAULT 0,
    total_derrotas INT NOT NULL DEFAULT 0,
    total_dinero_ganado DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_dinero_perdido DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    FOREIGN KEY (idUsuario) REFERENCES usuarios(id)
  )`,

  `CREATE TABLE IF NOT EXISTS baraja (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idPartida INT DEFAULT NULL,
    baraja LONGTEXT NOT NULL,
    fecha_partida DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (idPartida) REFERENCES partida(id)
  )`,

    /*
    Contraseña: admin → r@f3l2003.07.
    Contraseña: pru3b@1234 → usuario1
    Contraseña: pru3b@12345 → usuario2
    Contraseña: pru3b@12346 → usuario3 
  */
  `INSERT IGNORE INTO usuarios (nombre, correo, contraseña_Hash, dinero, rol, imagenPerfil) VALUES 
  ('admin', 'ramengual@gmail.com', '$2b$10$V2AiMTmuYw96EtbuSFR7Re34m.LyT/IE8mVu5RvEF9bjcHIXGJNiO', 10000.00, 'Administrador', NULL),
    ('usuario1', 'usuario1@example.com', '$2b$10$XyF2r7pALYkPeQJXHVnRBef9SDlsuYUv.k0NmZNF1eAVOEEpHFOUO', 1000.00, 'Jugador', NULL),
    ('usuario2', 'usuario2@example.com', '$2b$10$3Kc7upYwaLlk5Y9OexBeNeY9nZpAEEsP5PNEZUFcSl8grGUPhJjK6', 1000.00, 'Jugador', NULL),
    ('usuario3', 'usuario3@example.com', '$2b$10$7TN9xR7w5VlpYiLkfWqWNeQ60fiDYdpTn23tNCmhVpBUs4XePEbh.', 1000.00, 'Jugador', NULL);`


];

// 🔹 Ejecutar cada query en el orden correcto
for (const query of queries) {
  await db.query(query);
}

console.log('Tablas creadas correctamente.');


// 🔹 Exportar la conexión para el juego
export default db;
