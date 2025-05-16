      const socket = io();
      document.addEventListener("DOMContentLoaded", () => {
        renderizarBotonesInicio(currentUsername);
      });
      
      const roomId = window.location.pathname.split("/").pop();

      
      let botonesContainerGlobal = null;
      let currentUsername = "";
      let globalBotonesConfig = null; 

      
      socket.emit("joinRoom", roomId);
      socket.on('actualizarJugadores', (jugadores) => {
          const jugadoresLista = document.getElementById('jugadoresLista');
          jugadoresLista.innerHTML = '';

          jugadores.forEach(jugador => {
              const elemento = document.createElement('li');
              elemento.textContent = jugador;
              jugadoresLista.appendChild(elemento);
          });
      });
      
      socket.on("gameState", (gameState) => {
        currentUsername = gameState.currentUsername || currentUsername;
        

        
        renderGame(gameState);
      });

      
      socket.on("mostrarBotones", (botonesConfig) => {
        
        globalBotonesConfig = botonesConfig; 
        
        if (botonesContainerGlobal) {
          renderizarBotones(botonesConfig, botonesContainerGlobal, false);
        }
      });
      
      function renderizarFormularioApuesta() {
        let apuestaContainer =
          document.getElementById("apuestaContainer") ||
          document.createElement("div");
        apuestaContainer.id = "apuestaContainer";
        apuestaContainer.innerHTML = `
        <form id="betForm">
            <input type="number" id="betAmount" placeholder="Ingrese su apuesta" required>
            <button type="submit">Apostar</button>
        </form>
    `;
        document.body.appendChild(apuestaContainer);

        document
          .getElementById("betForm")
          .addEventListener("submit", handleBetSubmit, { once: true });
      }
      
      function handleBetSubmit(e) {
        e.preventDefault();
        const monto = Number(document.getElementById("betAmount").value);
        socket.emit("realizarApuesta", { roomId, monto });
        document.getElementById("apuestaContainer").style.display = "none";
      }

      
      function renderGame(gameState) {
        const mesa = document.querySelector(".mesa");
        mesa.innerHTML = ""; 

        gameState.state.jugadores.forEach((jugador) => {
          const silla = document.createElement("div");
          silla.classList.add(jugador.tipo);
          if (jugador.tipo === "Player") {
            silla.innerHTML = `
                <div class="info">
                  <div class="personal-container">
                    <p class="name">${jugador.nombre}</p>
                    <img src="/images/default-user.png" alt="Crupier" class="img-crupier">
                  </div>
                    <p class="puntos">Puntos: ${jugador.puntaje}</p>
                    <p class="apuesta">Apuesta: ${jugador.apuesta} monedas</p>
                </div>
                <div class="cartas"></div>
            `;
          } else if (jugador.tipo === "Crupier") {
            silla.innerHTML = `
                <div class="info">
                  <div class="personal-container">
                    <p class="name">${jugador.nombre}</p>
                    <img src="/images/dealer.png" alt="Crupier" class="img-crupier">
                  </div>
                    <p class="puntos">Puntos: ${jugador.puntaje}</p>
                </div>
                <div class="cartas"></div>
            `;
          }

          const cartasContainer = silla.querySelector(".cartas");
          if (cartasContainer && Array.isArray(jugador.cartas)) {
            jugador.cartas.forEach((carta) => {
              const card = document.createElement("div");
              card.classList.add("cards");
              card.textContent = carta.numero;
              cartasContainer.appendChild(card);
            });
          }

          if (jugador.tipo === "Player" && jugador.nombre === currentUsername) {
            let botonesContainer = silla.querySelector(".botones-container");
            if (!botonesContainer) {
              botonesContainer = document.createElement("div");
              botonesContainer.classList.add("botones-container");
              silla.appendChild(botonesContainer);
            }
            botonesContainerGlobal = botonesContainer;
            renderizarBotones(
              ["btnPedirCarta", "btnPlantarse"],
              botonesContainerGlobal,
              jugador.plant
            );
          }

          mesa.appendChild(silla);
        });

        
        const totalApuestasDiv = document.getElementById("totalApuestas");
        if (!totalApuestasDiv) {
          const totalApuestasContainer = document.createElement("div");
          totalApuestasContainer.id = "totalApuestas";
          totalApuestasContainer.innerHTML = `<p>Total Apuestas en la Partida: ${gameState.state.totalApuestas} monedas</p>`;
          document.body.appendChild(totalApuestasContainer);
        } else {
          totalApuestasDiv.innerHTML = `<p>Total Apuestas en la Partida: ${gameState.state.totalApuestas} monedas</p>`;
        }

        
        if (botonesContainerGlobal && globalBotonesConfig) {
          renderizarBotones(globalBotonesConfig, botonesContainerGlobal, false);
        }

        
        renderTotalApuestas(gameState.state.totalApuestas);

        
        if (gameState.state.reiniciada || gameState.state.totalApuestas === 0) {
          renderizarFormularioApuesta();
        }

        
        const turnoActual = gameState.state.turnoActual;
        const jugadorEnTurno = gameState.state.jugadores[turnoActual];

        
        const esMiTurno = jugadorEnTurno.nombre === currentUsername;

        
        document.getElementById("btnPedirCarta").disabled =
          !esMiTurno || jugadorEnTurno.plant;
        document.getElementById("btnPlantarse").disabled =
          !esMiTurno || jugadorEnTurno.plant;
        document.getElementById("betForm").style.display = esMiTurno
          ? "block"
          : "none";
      }
      function renderizarBotones(
        botonesConfig,
        container,
        deshabilitado = false
      ) {
        container.innerHTML = "";
        const botones = botonesConfig || ["btnPedirCarta", "btnPlantarse"];

        botones.forEach((btnId) => {
          const button = document.createElement("button");

          switch (btnId) {
            case "btnPedirCarta":
              button.textContent = "Pedir Carta";
              button.id = "btnPedirCarta";
              button.classList.add("more");
              button.addEventListener("click", () =>
                socket.emit("requestCard", { roomId })
              );
              break;
            case "btnPlantarse":
              button.textContent = "Plantarse";
              button.id = "btnPlantarse";
              button.classList.add("plant");
              button.addEventListener("click", () =>
                socket.emit("plantarse", { roomId })
              );
              break;
            default:
              console.warn("Identificador de botón no reconocido:", btnId);
              button.textContent = "Botón desconocido";
          }

          if (deshabilitado) {
            button.setAttribute("disabled", true);
          }
          container.appendChild(button);
        });
      }

      
      function renderizarBotonesInicio(usuario) {
        let container = document.getElementById("botonesInicio");
        if (!container) {
          container = document.createElement("div");
          container.id = "botonesInicio";
          document.body.appendChild(container);
        }
        container.innerHTML = ""; 

        let botonesConfig = ["btnUnirsePartida"];

        botonesConfig.forEach((btnId) => {
          const button = document.createElement("button");

          switch (btnId) {
            case "btnUnirsePartida":
              button.textContent = "Unirse a la partida";
              button.classList.add("joinGame");
              button.addEventListener("click", () => {
                socket.emit("addPlayer", { roomId, username: usuario });
                button.style.display = "none"; 
              });
              break;
          }

          container.appendChild(button);
        });
      }

      
      function renderTotalApuestas(totalApuestas) {
        let totalApuestasDiv = document.getElementById("totalApuestas");
        if (!totalApuestasDiv) {
          totalApuestasDiv = document.createElement("div");
          totalApuestasDiv.id = "totalApuestas";
          document.body.appendChild(totalApuestasDiv);
        }
        totalApuestasDiv.innerHTML = `<p>Total Apuestas en la Partida: ${totalApuestas} monedas</p>`;
      }
      /* --- Otras funcionalidades (por ejemplo, chat) --- */
      
      socket.on("setBackground", (color) => {
        document.body.style.backgroundColor = color;
      });

      
      socket.on("error", (error) => {
        console.error("Error recibido del servidor:", error);
      });

      
      const betForm = document.getElementById("betForm");
      betForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const monto = Number(document.getElementById("betAmount").value);
        
        socket.emit("realizarApuesta", { roomId, monto });
        
        document.getElementById("apuestaContainer").style.display = "none";
      });

      
      socket.on("iniciarCuenta", (duracion) => {
        
        let timerDisplay = document.getElementById("timerDisplay");
        if (!timerDisplay) {
          timerDisplay = document.createElement("div");
          timerDisplay.id = "timerDisplay";
          
          timerDisplay.style.position = "fixed";
          timerDisplay.style.top = "10px";
          timerDisplay.style.right = "10px";
          timerDisplay.style.background = "#f0f0f0";
          timerDisplay.style.padding = "10px";
          timerDisplay.style.border = "1px solid #ccc";
          document.body.appendChild(timerDisplay);
        }

        
        let segundosRestantes = duracion;
        timerDisplay.innerHTML = `Tiempo restante para unirse: ${segundosRestantes} segundos.`;

        const countdown = setInterval(() => {
          segundosRestantes--;
          if (segundosRestantes <= 0) {
            clearInterval(countdown);
            timerDisplay.innerHTML = "El tiempo para unirse ha finalizado.";
          } else {
            timerDisplay.innerHTML = `Tiempo restante para unirse: ${segundosRestantes} segundos.`;
          }
        }, 1000);
      });

      socket.on("cuentaFinalizada", (mensaje) => {
        let timerDisplay = document.getElementById("timerDisplay");
        if (!timerDisplay) {
          timerDisplay = document.createElement("div");
          timerDisplay.id = "timerDisplay";
          document.body.appendChild(timerDisplay);
        }
        timerDisplay.innerHTML = mensaje;
      });

      socket.on("bloquearAcciones", (bloquear) => {
  
  const btnPedirCarta = document.getElementById("btnPedirCarta");
  if (btnPedirCarta) btnPedirCarta.disabled = bloquear;

  
  const btnPlantarse = document.getElementById("btnPlantarse");
  if (btnPlantarse) btnPlantarse.disabled = true;

  
  const betForm = document.getElementById("betForm");
  if (betForm) {
    betForm.style.display = bloquear ? "none" : "block";
  }

  
  const btnUnirse = document.querySelector(".joinGame");
  if (btnUnirse) {
    btnUnirse.disabled = bloquear;
  }

  
  let mensajeBloqueo = document.getElementById("mensajeBloqueo");
  if (bloquear) {
    if (!mensajeBloqueo) {
      mensajeBloqueo = document.createElement("div");
      mensajeBloqueo.id = "mensajeBloqueo";
      
      mensajeBloqueo.style.position = "fixed";
      mensajeBloqueo.style.top = "20px";
      mensajeBloqueo.style.left = "50%";
      mensajeBloqueo.style.transform = "translateX(-50%)";
      mensajeBloqueo.style.backgroundColor = "#ffc";
      mensajeBloqueo.style.padding = "10px";
      mensajeBloqueo.style.border = "1px solid #ccc";
      document.body.appendChild(mensajeBloqueo);
    }
    mensajeBloqueo.textContent = "Esperando jugadores... la partida comenzará pronto.";
  } else {
    if (mensajeBloqueo) mensajeBloqueo.remove();
  }
});