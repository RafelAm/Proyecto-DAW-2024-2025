class  Participante{
    puntaje;
    cartas;
    plant = false; 
    constructor(){
        this.puntaje = 0;
        this.cartas = [];
    }

}

export class Crupier extends Participante{
    id;
    nombre;
    tipo; 
    constructor(){
        super();
        this.id = Math.floor(Math.random() * 100000);
        this.nombre = "Crupier";
        this.tipo = "Crupier";   
    }

}

export class Jugador extends Participante {
    id;
    socketId;
    nombre;
    tipo; 
    balance;
    apuesta;
    fichasApostadas; // <-- Añade esto

    constructor(id,nombre,balance,socketId) {
        super();
        this.id = id;
        this.socketId = socketId;
        this.nombre = nombre;
        this.tipo = "Player";   
        this.balance = balance;
        this.apuesta = 0;
        this.fichasApostadas = []; // <-- Añade esto
    }
}

class Baraja{

    cards 
    palos 

    constructor(){

        this.cards = ["A",2,3,4,5,6,7,8,9,10,"J","Q","K"];
        this.palos  = ["Corazones","Treboles","Picas","Diamantes"]

        let baraja =[];
        for(let i = 0; i < this.cards.length; i++){
            for(let j = 0; j < this.palos.length; j++){
                baraja.push({"palo": this.palos[j], "numero": this.cards[i],"Destapada":true});
            }
        }
        this.baraja = baraja;
        this.shuffle();
    }

    shuffle(){
        for(let i = 0; i < this.baraja.length; i++){
            let nIndex = Math.floor(Math.random() * (this.baraja.length-1));
            let valor = {...this.baraja[nIndex]};
            this.baraja[nIndex] = this.baraja[i];
            this.baraja[i] = valor;
        }
        
    }
}





export class Partida {
    constructor(jugadores, ruta) {
        this.idPartida = 0;
        this.idCrupier = 0;
        this.ruta = ruta;
        this.jugadores = jugadores;
        this.baraja = new Baraja();
        this.plantados = 0;
        this.totalApuestas = 0;
        this.turnoActual = 0;
        this.countDown = false;
        this.empezada = false;
        this.reiniciada = false;
        this.reiniciando = false;

    }

    toJSON() {
        if (this.plantados === this.jugadores.length - 1 && this.plantados >= 1) {
            this.iniciarNuevoJuego();
            return {
                idPartida: this.idPartida,
                idCrupier: this.idCrupier,
                ruta: this.ruta,
                jugadores: this.jugadores.map(j => ({
                    nombre: j.nombre,
                    tipo: j.tipo,
                    puntaje: j.puntaje,
                    cartas: j.cartas,
                    plant: j.plant,
                    balance: j.balance,
                    apuesta: 0
                })),
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                totalApuestas: 0,
                turnoActual: 0,
                empezada: this.empezada,
                ganadores: this.ganadorPuntuacion(),
                reiniciada: this.reiniciada,
                countDown: this.countDown
            };
        } else {
            return {
                idPartida: this.idPartida,
                idCrupier: this.idCrupier,
                ruta: this.ruta,
                jugadores: this.jugadores.map(j => ({
                    nombre: j.nombre,
                    tipo: j.tipo,
                    puntaje: j.puntaje,
                    cartas: j.cartas,
                    plant: j.plant,
                    balance: j.balance,
                    apuesta: j.apuesta
                })),
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                totalApuestas: this.totalApuestas,
                turnoActual: this.turnoActual,
                empezada: this.empezada,
                reiniciada: this.reiniciada,
                countDown: this.countDown
            };
        }
    }


    iniciarNuevoJuego() {
        if (this.reiniciando) return; 
        this.reiniciando = true;
        console.log("Esperando 20 segundos para reiniciar...");

        setTimeout(() => {
            console.log("Reiniciando partida...");
            this.idPartida = 0;
            this.idCrupier = 0;
            this.ruta = this.ruta;
            this.jugadores.forEach(player => {
                player.puntaje = 0;
                player.cartas = [];
                player.plant = false;
                player.apuesta = 0;
            });
            this.baraja = new Baraja();
            this.plantados = 0;
            this.totalApuestas = 0;
            this.turnoActual = 0;
            this.empezada = false;
            this.reiniciada = true;
            this.reiniciando = false;
        }, 20000);
    }
    


    
    

    repartirCartas() {
        let pActivos = 0;
        for (let i = 0; i < this.jugadores.length; i++) {
            if (this.jugadores[i] == null) continue;

            switch (this.jugadores[i].tipo) {
                case "Player":
                    for (let j = 0; j < 2; j++) {
                        let index = Math.floor(Math.random() * (this.baraja.baraja.length - 1));
                        this.jugadores[i].cartas.push(this.baraja.baraja[index]);
                        this.baraja.baraja.splice(index, 1);
                    }
                    pActivos++;
                    this.mostrarPuntuacion(i);
                    break;

                case "Crupier":
                    for (let j = 0; j < 2; j++) {
                        let index = Math.floor(Math.random() * (this.baraja.baraja.length - 1));
                        this.jugadores[i].cartas.push(this.baraja.baraja[index]);
                        this.baraja.baraja.splice(index, 1);
                    }
                    break;
            }
        }
    }

    pedirCarta(i) {
        let index = Math.floor(Math.random() * (this.baraja.baraja.length - 1));
        this.jugadores[i].cartas.push(this.baraja.baraja[index]);
        this.baraja.baraja.splice(index, 1);
        this.comprobarTotalCartas(i);
        this.mostrarPuntuacion(i);
        this.pasado(i);
    }

    comprobarTotalCartas(j) {
        this.jugadores[j].puntaje = 0;

        for (let i = 0; i < this.jugadores[j].cartas.length; i++) {
            if (this.jugadores[j].cartas[i]["numero"] == "A") {
                if ((this.jugadores[j].puntaje + 11) > 21) {
                    this.jugadores[j].puntaje += 1;
                } else {
                    this.jugadores[j].puntaje += 11;
                }
            } else if (
                ["Q", "K", "J"].includes(this.jugadores[j].cartas[i]["numero"])
            ) {
                this.jugadores[j].puntaje += 10;
            } else {
                this.jugadores[j].puntaje += this.jugadores[j].cartas[i]["numero"];
            }
        }
    }

    plantarse(j) {
        this.jugadores[j].plant = true;
        this.plantados++;
        this.mostrarPuntuacion(j);
        this.pasado(j);
        this.jugarCrupier(j);
    }

    jugarCrupier() {
        const posCrupier = this.jugadores.length - 1;
        if (this.plantados === this.jugadores.length - 1) {
            // Filtra los jugadores plantados que no se han pasado
            const jugadoresValidos = this.jugadores.filter(j =>
                j.tipo === "Player" && j.plant && j.puntaje <= 21
            );
            if (jugadoresValidos.length === 0) return; // Nadie válido a superar

            // El crupier intenta superar al mayor puntaje de los jugadores válidos
            let maxPuntaje = Math.max(...jugadoresValidos.map(j => j.puntaje));
            while (
                this.jugadores[posCrupier].puntaje < 17 ||
                (
                    this.jugadores[posCrupier].puntaje < maxPuntaje &&
                    this.jugadores[posCrupier].puntaje < 21
                )
            ) {
                this.pedirCarta(posCrupier);
            }
        }
    }

    pasado(i){
        if(this.jugadores[i].puntaje > 21){
        this.jugadores[i].plant = true
        this.plantados++
        }
    }

    ganadorPuntuacion() {
        let maxPuntaje = 0;
        let ganadores = [];

        for (let i = 0; i < this.jugadores.length; i++) {
            const jugador = this.jugadores[i];
            if (jugador.puntaje <= 21 && jugador.puntaje > maxPuntaje) {
                maxPuntaje = jugador.puntaje;
                ganadores = [jugador];
            } else if (jugador.puntaje === maxPuntaje && jugador.puntaje <= 21) {
                ganadores.push(jugador);
            }
        }
        return ganadores;
    }
      distribuirPremios() {
    const posCrupier = this.jugadores.findIndex(j => j.tipo === "Crupier");
    const crupier = this.jugadores[posCrupier];

    let totalApuestas = 0;
    this.jugadores.forEach(jugador => {
        if (jugador.tipo === "Player") {
            totalApuestas += jugador.apuesta;
        }
    });

    console.log(`Total de apuestas en juego: ${totalApuestas}`);

    // El crupier solo gana si TODOS los jugadores pierden (se pasan o tienen menos puntos)
    let algunJugadorGana = false;

    this.jugadores.forEach(jugador => {
        if (jugador.tipo !== "Player") return;

        if (jugador.puntaje > 21) {
            // Jugador pierde su apuesta
            console.log(`El jugador ${jugador.nombre} se pasó y pierde su apuesta.`);
        } else if (crupier.puntaje > 21) {
            // Crupier se pasa, todos los jugadores que no se pasaron ganan el doble
            jugador.balance += jugador.apuesta * 2;
            console.log(`El crupier se pasó; el jugador ${jugador.nombre} gana ${jugador.apuesta * 2}.`);
            algunJugadorGana = true;
        } else if (jugador.puntaje > crupier.puntaje) {
            let premio = jugador.apuesta * 2;
            jugador.balance += premio;
            console.log(`El jugador ${jugador.nombre} gana ${premio}.`);
            algunJugadorGana = true;
        } else if (jugador.puntaje === crupier.puntaje) {
            jugador.balance += jugador.apuesta; // Recupera su apuesta
            console.log(`El jugador ${jugador.nombre} empata y recupera su apuesta.`);
            algunJugadorGana = true;
        } else {
            // Jugador pierde su apuesta
            console.log(`El jugador ${jugador.nombre} pierde su apuesta.`);
        }

        jugador.apuesta = 0; // Reseteamos la apuesta del jugador
    });

    // Si ningún jugador gana o empata, el crupier se queda con todas las apuestas
    if (!algunJugadorGana) {
        console.log(`El crupier gana y se queda con ${totalApuestas} en apuestas restantes.`);
    } else {
        console.log(`Apuestas restantes después de repartir premios: 0`);
    }

    this.totalApuestas = 0; // Siempre se reinicia el total de apuestas al final de la ronda
}

    
    
    mostrarPuntuacion(i) {
        this.comprobarTotalCartas(i);
    }

    async reiniciar() {
        console.log("Reiniciando partida...");
        // Espera 20 segundos antes de reiniciar (esto lo controla el backend, puedes quitarlo aquí)
        // await new Promise(resolve => setTimeout(resolve, 20000));
        const crupier = this.jugadores.find(j => j.tipo === "Crupier");
        if (crupier) {
            crupier.cartas = [];
            crupier.puntaje = 0;
        }
        this.jugadores.forEach(player => {
            player.puntaje = 0;
            player.cartas = [];
            player.plant = false;
            if(player.tipo === "Player") {
                player.apuesta = 0;
            }
        });
        this.baraja = new Baraja();
        this.plantados = 0;
        this.empezada = false;
        this.reiniciada = true;
        this.totalApuestas = 0;
        // Quita la llamada a this.iniciarNuevoJuego();
    }
        

    realizarApuesta(indexJugador, monto) {
        const jugador = this.jugadores[indexJugador];
        if (monto > jugador.balance) {
            throw new Error("Fondos insuficientes para apostar esa cantidad.");
        }
        jugador.apuesta = monto;
        jugador.balance -= monto;
        this.totalApuestas += monto; 
    }
    
}


