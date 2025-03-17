### Proyecto-DAW-2024-2025
# ♠️ BlackJack ♦️


## 📜 Objetivos Generales
Diseñar un juego interactivo accesible desde el navegador, respaldado por un servidor Express que gestione de forma eficiente y rápida las peticiones de los jugadores,
garantizando una experiencia en tiempo real. Este proyecto prioriza no solo una experiencia fluida y veloz, sino también una interfaz enriquecida con elementos visuales dinámicos y atractivos que fomenten la inmersión del usuario.

Este enfoque busca fusionar funcionalidad, estética y entretenimiento, ofreciendo una plataforma que combine eficiencia técnica con un diseño memorable y altamente accesible.

## 🖥️ Temática

  Juego de Cartas Enfocado en BlackJack, con reglas básicas y posibles variaciones de estas.

## ⚙️ Tecnologías

 ⚠️ Las tecnologías pueden tener algún que otro cambio.

    Front-End:
      - HTML
      - CSS con Sass (posible cambio a TailWind)
      - JavaScript
        El procesador de la informacion que recibe el cliente, me he decidido por JavaScript porque me parece un lenguaje muy interesante y bastante completo.
      
    Back-End:
      - Node.js con Express
        Lo he seleccionado porque me parecia curioso probar un framework en JavaScript y asi tener todo el codigo en un mismo lenguaje,
        dada la información buscada y los cursos que he revisado me ha parecido una buena opción que permite ser escalable sin dar ningun problema
      - Socket.io
        Modulo de Express que permite la transferencia de la información de la partida a los demás clientes y estos puedan cargarla y poder tener una persistencia de datos simultanea.
        Buscando información y demás he llegado a la conclusión que socket.io es suficiente para la tranferencia de la información, hay otras opciones como websocket pero en este caso no necesitamos algo tan técnico.
      - MySql
        En este caso he decidido mantener mysql por la familiaridad que tengo con este y la comodidad,
        principalmente no se van a guardar masificación de datos, solamente usuarios, puntuaciones y resultados de partidas para luego su procesamiento de estadísticas de juego por usuario.
        
