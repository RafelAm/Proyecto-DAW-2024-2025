
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

    constructor(nombre) {
        super();
        this.id = Math.floor(Math.random() * 100000);
        this.nombre = nombre;
        this.tipo = "Player";   
        this.balance = 1000; // Capital inicial para el jugador.
        this.apuesta = 0;    // Apuesta actual (iniciada en 0).
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
                baraja.push({"Palo": this.palos[j], "Número": this.cards[i],"Destapada":true});
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
        this.name = "New Game";
        this.baraja = new Baraja();
        this.plantados = 0;
        this.jugadores = jugadores;
        this.empezada = false;
        this.reiniciada = false;
        this.totalApuestas = 0;
        this.turnoActual = 0;
    }

    async iniciarNuevoJuego() {
        await this.reiniciar();
        console.log("¡Partida reiniciada con éxito!");
    }
    


    siguienteTurno() {
        do {
            this.turnoActual = (this.turnoActual + 1) % this.jugadores.length;
        } while (this.jugadores[this.turnoActual].plant || this.jugadores[this.turnoActual].tipo === "Crupier");
    
        this.verificarSiCrupierDebeJugar();
    }
    
    

    verificarSiCrupierDebeJugar() {
        const todosPlantados = this.jugadores.every(j => j.tipo !== "Crupier" && j.plant);
        if (todosPlantados) {
            this.jugarCrupier();
        }
    }

    iniciarTurnoActual() {
        const jugador = this.jugadores[this.turnoActual];
        if (jugador.tipo === "Player" && !jugador.plant) {
            setTimeout(() => {
                if (!jugador.plant) {
                    this.plantarse(this.turnoActual);
                }
                this.siguienteTurno();
                io.to(this.roomId).emit('gameState', { state: this.toJSON() });
            }, 15000);
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
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                empezada: this.empezada,
                ganadores: "",
                reiniciada: true,
                totalApuestas: 0, // Reiniciamos la apuesta total aquí
                turnoActual: 0
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
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                empezada: this.empezada,
                ganadores: "",
                reiniciada: false,
                totalApuestas: this.totalApuestas,
                turnoActual: this.turnoActual
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
            if (this.jugadores[j].cartas[i]["Número"] == "A") {
                if ((this.jugadores[j].puntaje + 11) > 21) {
                    this.jugadores[j].puntaje += 1;
                } else {
                    this.jugadores[j].puntaje += 11;
                }
            } else if (
                ["Q", "K", "J"].includes(this.jugadores[j].cartas[i]["Número"])
            ) {
                this.jugadores[j].puntaje += 10;
            } else {
                this.jugadores[j].puntaje += this.jugadores[j].cartas[i]["Número"];
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

    /*
      Método que compara cada jugador (tipo "Player") contra el crupier y
      distribuye los premios según las reglas:
      
      - Si el jugador se pasa (>21): pierde su apuesta.
      - Si el crupier se pasa y el jugador no: gana, recibe 2x la apuesta.
      - Si el jugador tiene mayor puntaje que el crupier sin pasarse: gana.
      - Si empata con el crupier: se devuelve la apuesta.
      - Si el jugador tiene un puntaje menor: pierde la apuesta.
    */
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
    
        // Si el crupier gana, reiniciamos la apuesta total a 0.
        if (crupierGana) {
            console.log("El crupier gana, todas las apuestas se reinician.");
            this.totalApuestas = 0;
        }
    }
    
    
    mostrarPuntuacion(i) {
        this.comprobarTotalCartas(i);
    }

    

     // Reinicia la partida (conservando información como el balance de cada jugador)
     async reiniciar() {
        console.log("Esperando 20 segundos para reiniciar...");
        await new Promise(resolve => setTimeout(resolve, 20000));
    
        console.log("Reiniciando partida...");
        
        this.jugadores = this.jugadores.map(player => ({
            nombre: player.nombre,
            tipo: player.tipo,
            puntaje: 0,
            cartas: [],
            plant: false,
            balance: player.balance,
            apuesta: 0
        }));
    
        this.baraja = new Baraja();
        this.plantados = 0;
        this.empezada = false;
        this.reiniciada = true;
        this.totalApuestas = 0; // Aseguramos que el total se reinicie.
    }
    
    

    /**
     * Coloca la apuesta de un jugador.
     * @param {number} indexJugador - Índice del jugador en el array.
     * @param {number} monto - La cantidad que desea apostar.
     */
    realizarApuesta(indexJugador, monto) {
        const jugador = this.jugadores[indexJugador];
        if (monto > jugador.balance) {
            throw new Error("Fondos insuficientes para apostar esa cantidad.");
        }
        jugador.apuesta = monto;
        jugador.balance -= monto;
        this.totalApuestas += monto; // Sumamos al total.
    }
    
}


