/*
  SIMULATORE ARDUINO — solo per fare una prova sul PC, senza hardware.

  Manda al server dati finti che scendono nel tempo, esattamente come
  farebbe l'Arduino vero. Utile per vedere il sito aggiornarsi da solo.

  COME SI USA:
    1. In un terminale: node server.js        (lascialo aperto)
    2. In un altro terminale: node simula-arduino.js
    3. Apri il sito e guarda la bacheca "disponibilità in tempo reale"
*/

const URL_SERVER = "http://localhost:3000/api/stato";
const CHIAVE_ARDUINO = "cambia-questa-chiave"; // deve combaciare con server.js

let macchine = [
  { nome: "Lavatrice 9 Kg - A",  secondi: 0 },
  { nome: "Lavatrice 9 Kg - B",  secondi: 20 * 60 },
  { nome: "Lavatrice 14 Kg - C", secondi: 5 * 60 },
  { nome: "Lavatrice 18 Kg - D", secondi: 0 }
];

async function inviaStato() {
  macchine = macchine.map(m => ({ ...m, secondi: Math.max(0, m.secondi - 10) }));

  try {
    const risposta = await fetch(URL_SERVER, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chiave": CHIAVE_ARDUINO },
      body: JSON.stringify({ macchine })
    });
    console.log(risposta.ok ? "Stato inviato" : "Errore invio: " + risposta.status);
  } catch (err) {
    console.log("Server non raggiungibile, hai lanciato node server.js?");
  }
}

console.log("Simulatore avviato: invio uno stato finto ogni 10 secondi (Ctrl+C per fermarlo)");
inviaStato();
setInterval(inviaStato, 10000);
