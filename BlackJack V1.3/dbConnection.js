import mysql2 from "mysql2";

const db = mysql2.createConnection({
    host: "localhost",
    user: "root",
    password: "1234",
    database: "users",
});

db.connect((err) => {
    if (err) throw err;
    console.log("Connected!!!");
});

export default db;
