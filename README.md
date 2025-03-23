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

  ✏️ Front-End:

 - HTML
 - CSS con Sass (posible cambio a TailWind)
 - JavaScript
	- El procesador de la información que recibe el cliente, me he decidido por JavaScript porque me parece un lenguaje muy interesante y bastante completo.
      
  🪛 Back-End:
 - Node.js con Express
	 - Lo he seleccionado porque me parecía curioso probar un framework en JavaScript y así tener todo el código en un mismo lenguaje, dada la información buscada y los cursos que he revisado me ha parecido una buena opción que permite ser escalable sin dar ningún problema
  - Socket.io
	   - Modulo de Express que permite la transferencia de la información de la partida a los demás clientes y estos puedan cargarla y poder tener una persistencia de datos simultanea.
        Buscando información y demás he llegado a la conclusión que socket.io es suficiente para la transferencia de la información, hay otras opciones como websocket pero en este caso no necesitamos algo tan técnico.
   - MySql
	    - En este caso he decidido mantener mysql por la familiaridad que tengo con este y la comodidad,
        principalmente no se van a guardar masificación de datos, solamente usuarios, puntuaciones y resultados de partidas para luego su procesamiento de estadísticas de juego por usuario.

## 🔧 Diagrama de Clases y E/R
![Diagrama en blanco (2)](https://github.com/user-attachments/assets/b165abb6-de52-4f65-9632-715a63b1c1ce)

## Wireframe
  Puede ser que estos tengan algun cambio en función del contenido y el tamaño de las pantallas.
  ### Ordenador
   #### Home Page
   
   ![Home-PC](https://github.com/user-attachments/assets/b0dedf66-1e77-4ec2-8760-c3160016f867)
   #### Login - Register
   ![L-R PC](https://github.com/user-attachments/assets/e4493d65-8075-41ec-9f0f-c122fe7ba54f)
   #### Partida
   ![Game-PC](https://github.com/user-attachments/assets/fee866b2-5296-4ec2-858e-3185c7c59dc3)

  ### Tablet
   #### Home Page
   ![Home-Tab](https://github.com/user-attachments/assets/4044c21f-dc93-4dfb-afec-40d05022b1db)
   #### Login - Register
   ![L-R Tab](https://github.com/user-attachments/assets/13919b83-e55b-47d5-84c1-871eebc5b2b5)
   #### Partida
   ![Game-Tab](https://github.com/user-attachments/assets/b7f9ce4e-fa13-4a5a-b0db-503624243786)

  ### Movil
   #### Home Page
   ![Home-Mv](https://github.com/user-attachments/assets/44445015-ff0b-46cf-9d82-941e922fddc5)
   #### Login - Register
   ![L-R Mv](https://github.com/user-attachments/assets/0a929d19-1d31-41b3-ada3-178cdcce35ce)
   #### Partida
   ![Game-Mv](https://github.com/user-attachments/assets/4c907326-fca5-428e-8a57-45f2c2805cfa)
