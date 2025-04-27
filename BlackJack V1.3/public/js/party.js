
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

export class Jugador extends Participante{
    id;
    nombre;
    tipo; 
    constructor(nombre){
        super();
        this.id = Math.floor(Math.random() * 100000);
        this.nombre = nombre;
        this.tipo = "Player";   
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
    }

    async iniciarNuevoJuego() {
        await this.reiniciar();
        console.log("¡Partida reiniciada con éxito!");
    }
    

    toJSON() {
        // Si se cumple la condición de reinicio, iniciamos la secuencia de reinicio...
        if (this.plantados === this.jugadores.length - 1 && this.plantados >= 1) {
            // Iniciamos el reinicio de manera asíncrona, pero retornamos un estado para el cliente
            // NOTA: Esto hará que el cliente reciba primero un estado de "reiniciada" en true,
            // mientras que la lógica de reinicio se ejecuta.
            this.iniciarNuevoJuego();
            return {
                jugadores: this.jugadores.map(j => ({
                    nombre: j.nombre,
                    tipo: j.tipo,
                    puntaje: j.puntaje,
                    cartas: j.cartas,
                    plant: j.plant
                })),
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                empezada: this.empezada,
                ganadores: "",
                reiniciada: true
            };
        } else {
            return {
                jugadores: this.jugadores.map(j => ({
                    nombre: j.nombre,
                    tipo: j.tipo,
                    puntaje: j.puntaje,
                    cartas: j.cartas,
                    plant: j.plant
                })),
                baraja: this.baraja.baraja,
                plantados: this.plantados,
                empezada: this.empezada,
                ganadores: "",
                reiniciada: false
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
            if (this.jugadores[i].puntaje <= 21 && this.jugadores[i].puntaje > maxPuntaje) {
                maxPuntaje = this.jugadores[i].puntaje;
                ganadores = [this.jugadores[i]];
            } else if (this.jugadores[i].puntaje === maxPuntaje && this.jugadores[i].puntaje <= 21) {
                ganadores.push(this.jugadores[i]);
            }
        }

        return ganadores.length === 1
        ? `El ganador es: ${ganadores[0].nombre} con ${ganadores[0].puntaje} puntos`
        : ganadores.length > 1
        ? `Hay un empate entre los jugadores: ${ganadores.map(g => g.nombre).join(", ")}`
        : "No hay ganador, todos los jugadores se pasaron de 21 puntos";
         
    }

    mostrarPuntuacion(i) {
        this.comprobarTotalCartas(i);
    }

    

    async reiniciar() {
        console.log("Esperando 20 segundos para reiniciar...");
        await new Promise(resolve => setTimeout(resolve, 20000));
    
        console.log("Reiniciando partida...");
        
        // Reiniciar los jugadores
        this.jugadores = this.jugadores.map(player => ({
            nombre: player.nombre,
            tipo: player.tipo,
            puntaje: 0,
            cartas: [],
            plant: false
        }));
    
        // Reiniciar la baraja
        this.baraja = new Baraja();
    
        // Reiniciar otros valores
        this.plantados = 0;
        this.empezada = false;
        this.reiniciada = true;

    }
    
    
}


