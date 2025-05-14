
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
    nombre;
    tipo; 
    balance;
    apuesta;

    constructor(id,nombre,balance) {
        super();
        this.id = id;
        this.nombre = nombre;
        this.tipo = "Player";   
        this.balance = balance;
        this.apuesta = 0;
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
    constructor(jugadores) {
        this.idPartida = 0;
        this.idCrupier = 0;
        this.name = "New Game";
        this.baraja = new Baraja();
        this.plantados = 0;
        this.jugadores = jugadores;
        this.empezada = false;
        this.reiniciada = false;
        this.reiniciando = false;
        this.totalApuestas = 0;
        this.turnoActual = 0;
        this.countDown = false;
    }

    iniciarNuevoJuego() {
        if (this.reiniciando) return; 
        this.reiniciando = true;
        console.log("Esperando 20 segundos para reiniciar...");

        setTimeout(() => {
            console.log("Reiniciando partida...");

            this.jugadores.forEach(player => {
                player.puntaje = 0;
                player.cartas = [];
                player.plant = false;
                player.apuesta = 0;
            });
            this.idPartida = 0;
            this.idCrupier = 0;
            this.baraja = new Baraja();
            this.plantados = 0;
            this.empezada = false;
            this.reiniciada = true;
            this.totalApuestas = 0;
            this.turnoActual = 0;

            this.reiniciando = false;  // ✅ Finaliza el proceso
        }, 20000);
    }
    
    


    siguienteTurno() {
        this.turnoActual = this.jugadores.findIndex(j => j.tipo === "Player" && !j.plant);
    
        if (this.turnoActual === -1) {
            this.verificarSiCrupierDebeJugar();
        }
    }
    
    

    verificarSiCrupierDebeJugar() {
        const todosPlantados = this.jugadores.every(j => j.tipo !== "Crupier" && j.plant);
        if (todosPlantados) {
            this.jugarCrupier();
        }
    }

    
    

    toJSON() {
        if (this.plantados === this.jugadores.length - 1 && this.plantados >= 1) {
            this.iniciarNuevoJuego();
            return {

                jugadores: this.jugadores.map(j => ({
                    nombre: j.nombre,
                    tipo: j.tipo,
                    puntaje: j.puntaje,
                    cartas: j.cartas,
                    plant: j.plant,
                    balance: j.balance,
                    apuesta: 0
                })),
                idPartida: this.idPartida,
                idCrupier: this.idCrupier,
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                empezada: this.empezada,
                ganadores: this.ganadorPuntuacion(),
                reiniciada: true,
                totalApuestas: 0,
                turnoActual: 0,
                countDown: this.countDown
            };
        } else {
            return {

                jugadores: this.jugadores.map(j => ({
                    nombre: j.nombre,
                    tipo: j.tipo,
                    puntaje: j.puntaje,
                    cartas: j.cartas,
                    plant: j.plant,
                    balance: j.balance,
                    apuesta: j.apuesta
                })),
                idPartida: this.idPartida,
                idCrupier: this.idCrupier,
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                empezada: this.empezada,
                ganadores: "",
                reiniciada: false,
                totalApuestas: this.totalApuestas,
                turnoActual: this.turnoActual,
                countDown: this.countDown
            };
        }
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
                    let index = Math.floor(Math.random() * (this.baraja.baraja.length - 1));
                    this.jugadores[i].cartas.push(this.baraja.baraja[index]);
                    this.baraja.baraja.splice(index, 1);
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

    jugarCrupier(j) {
        const posCrupier = this.jugadores.length - 1;
        if (this.plantados == this.jugadores.length - 1) {
            while (this.jugadores[posCrupier].puntaje < 17 || (this.jugadores[j].puntaje > this.jugadores[posCrupier].puntaje && this.jugadores[j].puntaje <= 21)) {
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
    
        let crupierGana = false;
    
        this.jugadores.forEach(jugador => {
            if (jugador.tipo !== "Player") return;
    
            if (jugador.puntaje > 21) {
                console.log(`El jugador ${jugador.nombre} se pasó y pierde su apuesta.`);
                crupierGana = true;
            } else if (crupier.puntaje > 21) {
                jugador.balance += jugador.apuesta * 2;
                console.log(`El crupier se pasó; el jugador ${jugador.nombre} gana ${jugador.apuesta * 2}.`);
            } else if (jugador.puntaje > crupier.puntaje) {
                jugador.balance += jugador.apuesta * 2;
                console.log(`El jugador ${jugador.nombre} gana ${jugador.apuesta * 2}.`);
            } else if (jugador.puntaje === crupier.puntaje) {
                jugador.balance += jugador.apuesta;
                console.log(`El jugador ${jugador.nombre} empata y recupera su apuesta.`);
            } else {
                crupierGana = true;
                console.log(`El jugador ${jugador.nombre} pierde su apuesta.`);
            }
    
            jugador.apuesta = 0;
        });
            if (crupierGana) {
            console.log("El crupier gana, todas las apuestas se reinician.");
            this.totalApuestas = 0;
        }
    }
    
    
    mostrarPuntuacion(i) {
        this.comprobarTotalCartas(i);
    }

    async reiniciar() {
        console.log("Reiniciando partida...");
        await new Promise(resolve => setTimeout(resolve, 20000));
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


