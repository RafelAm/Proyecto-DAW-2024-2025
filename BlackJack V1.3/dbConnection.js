import mysql2 from "mysql2";

const db = mysql2.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "blackjackdb",
}).promise();

db.connect((err) => {
    if (err) throw err;
    console.log("Connected!!!");
});

export default db;
