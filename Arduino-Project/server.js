/*
  L'ORSETTO LAVATORE — server di stato lavatrici

  COSA FA:
  - Riceve dall'Arduino, ogni pochi secondi, lo stato delle 4 lavatrici
    (POST /api/stato).
  - Lo mette a disposizione del sito e della app (GET /api/stato).
  - Quando una lavatrice passa da "in corso" a "finita", chiama la
    funzione inviaSms() — da collegare al tuo gestore SMS.

  COME SI AVVIA (sul tuo PC, per fare una prova):
    npm install express cors
    node server.js
  Il server parte su http://localhost:3000

  PER METTERLO ONLINE:
  Va caricato su un hosting che rimanga sempre acceso (es. Render,
  Railway, un piccolo VPS...). Il sito e l'Arduino puntano poi
  all'indirizzo pubblico che quell'hosting ti assegna, con HTTPS.
*/

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Pagina di controllo rapido: apri l'indirizzo del server nel browser
// e se vedi questo messaggio vuol dire che è acceso e raggiungibile.
app.get("/", (req, res) => {
  res.send("Server L'Orsetto Lavatore attivo. Prova /api/stato per vedere i dati.");
});

// ---- Contatore visite del sito ----
// Il numero viene salvato in un file, così resta anche se il server
// si riavvia (a differenza dei dati delle macchine, che sono solo in memoria).
const FILE_CONTATORE = path.join(__dirname, "contatore.json");

function leggiContatore() {
  try {
    return JSON.parse(fs.readFileSync(FILE_CONTATORE, "utf8")).visite || 0;
  } catch {
    return 0;
  }
}

function scriviContatore(valore) {
  fs.writeFileSync(FILE_CONTATORE, JSON.stringify({ visite: valore }));
}

// Il sito chiama questo indirizzo a ogni apertura di pagina: +1 e restituisce il totale
app.get("/api/visita", (req, res) => {
  const nuovoValore = leggiContatore() + 1;
  scriviContatore(nuovoValore);
  res.json({ visite: nuovoValore });
});

// ---- Listino prezzi, modificabile dal pannello proprietario ----
// I NOMI delle lavatrici non si toccano da qui: sono agganciati al
// firmware Arduino, che li usa per riconoscere ogni macchina. Da qui
// si modificano solo i prezzi (e, per le asciugatrici, anche il tempo).
const FILE_LISTINO = path.join(__dirname, "listino.json");

// Cambia questa password prima di usare il pannello sul serio.
// Deve essere la stessa cosa che scrivi anche in admin.html.
// Cambia questa password prima di usare il pannello sul serio.
// NON scriverla qui nel codice: impostala come variabile d'ambiente
// su Render (Settings del servizio -> Environment -> Add Environment
// Variable -> chiave "PASSWORD_PROPRIETARIO", valore la tua password).
// Il valore qui sotto è solo una riserva per le prove in locale.
const PASSWORD_PROPRIETARIO = process.env.PASSWORD_PROPRIETARIO || "cambia-questa-password";
if (!process.env.PASSWORD_PROPRIETARIO) {
  console.warn("ATTENZIONE: PASSWORD_PROPRIETARIO non impostata come variabile d'ambiente, sto usando quella di riserva. Da sistemare prima di andare online sul serio.");
}

const LISTINO_DEFAULT = {
  lavatrici: [
    { nome: "Lavatrice 9 Kg - A",  prezzo: 4.50 },
    { nome: "Lavatrice 9 Kg - B",  prezzo: 4.50 },
    { nome: "Lavatrice 14 Kg - C", prezzo: 6.50 },
    { nome: "Lavatrice 18 Kg - D", prezzo: 8.50 }
  ],
  asciugatrici: { minutiPerImpulso: 15, prezzo: 2.50 },
  sacchettoSottovuoto: 2.00
};

function leggiListino() {
  try {
    return JSON.parse(fs.readFileSync(FILE_LISTINO, "utf8"));
  } catch {
    return LISTINO_DEFAULT;
  }
}

function scriviListino(dati) {
  fs.writeFileSync(FILE_LISTINO, JSON.stringify(dati, null, 2));
}

// Il sito legge qui i prezzi attuali: nessuna password richiesta,
// è solo lettura, come guardare un cartellone prezzi in negozio.
app.get("/api/listino", (req, res) => {
  res.json(leggiListino());
});

// Il pannello proprietario scrive qui le modifiche: richiede la password.
app.post("/api/listino", limitaRichieste, (req, res) => {
  const password = req.header("X-Password");
  if (password !== PASSWORD_PROPRIETARIO) {
    return res.status(401).json({ errore: "password errata" });
  }
  scriviListino(req.body);
  res.json({ ok: true });
});

// Chiave segreta condivisa: solo l'Arduino deve poterla usare per
// scrivere lo stato. Cambiala con un valore a tua scelta, e mettine
// una uguale nel firmware se vuoi aggiungere il controllo (opzionale
// ma consigliato prima di andare online).
// Stessa cosa per la chiave dell'Arduino: impostala su Render come
// variabile d'ambiente "CHIAVE_ARDUINO", e usa lo STESSO valore anche
// nel firmware lavatrici_arduino.ino (quella invece resta scritta nel
// file, perché l'Arduino non può leggere variabili d'ambiente — ma
// almeno il server non la espone più su GitHub).
const CHIAVE_ARDUINO = process.env.CHIAVE_ARDUINO || "wp4ymc1VZtuH7rrDmm6HHXAOyqJcewLl";
if (!process.env.CHIAVE_ARDUINO) {
  console.warn("ATTENZIONE: CHIAVE_ARDUINO non impostata come variabile d'ambiente, sto usando quella di riserva. Da sistemare prima di andare online sul serio.");
}

// Stato in memoria (per iniziare; per un uso serio conviene un database
// che non si svuoti ogni volta che il server si riavvia)
let statoMacchine = {
  "Lavatrice 9 Kg - A":  { secondi: 0, pausa: false, telefono: null },
  "Lavatrice 9 Kg - B":  { secondi: 0, pausa: false, telefono: null },
  "Lavatrice 14 Kg - C": { secondi: 0, pausa: false, telefono: null },
  "Lavatrice 18 Kg - D": { secondi: 0, pausa: false, telefono: null },
  // Asciugatrici: non ancora collegate fisicamente all'Arduino (in
  // attesa del cambio centraline), ma già pronte a ricevere dati non
  // appena lo saranno, senza dover toccare il server in quel momento.
  "Asciugatrice 1": { secondi: 0, pausa: false, telefono: null },
  "Asciugatrice 2": { secondi: 0, pausa: false, telefono: null },
  "Asciugatrice 3": { secondi: 0, pausa: false, telefono: null },
  "Asciugatrice 4": { secondi: 0, pausa: false, telefono: null }
};

// Registro tessera -> telefono. Chi paga in contanti non ci finisce mai
// dentro, quindi non riceverà mai un SMS: solo lo stato sul sito.
let registroTessere = {
  // "1234567890": "+39333xxxxxxx"
};

// L'Arduino manda qui lo stato aggiornato
app.post("/api/stato", (req, res) => {
  const chiave = req.header("X-Chiave");
  if (chiave !== CHIAVE_ARDUINO) {
    return res.status(401).json({ errore: "chiave non valida" });
  }

  const macchine = req.body.macchine || [];
  macchine.forEach((m) => {
    if (!statoMacchine[m.nome]) return;

    const eraInCorso = statoMacchine[m.nome].secondi > 0;
    const oraLibera = m.secondi <= 0;

    // Se il ciclo è appena finito, manda l'SMS (solo se un telefono
    // era stato associato tramite tessera) e libera l'associazione
    if (eraInCorso && oraLibera) {
      const telefono = statoMacchine[m.nome].telefono;
      if (telefono) {
        inviaSms(telefono, `${m.nome}: il tuo bucato è pronto! Puoi venire a ritirarlo.`);
      }
      statoMacchine[m.nome].telefono = null;
    }

    statoMacchine[m.nome].secondi = m.secondi;
    statoMacchine[m.nome].pausa = !!m.pausa;
  });

  res.json({ ok: true });
});

// Il sito e la app leggono qui lo stato attuale
app.get("/api/stato", (req, res) => {
  const risposta = Object.entries(statoMacchine).map(([nome, dati]) => ({
    nome,
    libera: dati.secondi <= 0,
    secondi: dati.secondi,
    pausa: dati.pausa
  }));
  res.json({ macchine: risposta });
});

// ---- Limite semplice di richieste, per evitare abusi sugli indirizzi
// pubblici (registrazione tessera, associazione macchina). Non richiede
// librerie in più: tiene solo un conteggio in memoria per ogni IP.
const richiestePerIp = {};
const LIMITE_RICHIESTE = 15;      // richieste
const FINESTRA_MS = 5 * 60 * 1000; // ogni 5 minuti

function limitaRichieste(req, res, next) {
  const ip = req.ip;
  const ora = Date.now();
  const voce = richiestePerIp[ip] || { conteggio: 0, dalMillis: ora };
  if (ora - voce.dalMillis > FINESTRA_MS) {
    voce.conteggio = 0;
    voce.dalMillis = ora;
  }
  voce.conteggio++;
  richiestePerIp[ip] = voce;
  if (voce.conteggio > LIMITE_RICHIESTE) {
    return res.status(429).json({ errore: "troppe richieste, riprova tra qualche minuto" });
  }
  next();
}

// Un numero di telefono scritto in modo ragionevole: cifre, spazi, + iniziale
function telefonoValido(t) {
  return typeof t === "string" && /^[+\d][\d\s]{6,18}$/.test(t.trim());
}
function tesseraValida(t) {
  return typeof t === "string" && t.trim().length >= 1 && t.trim().length <= 40;
}

// PASSAGGIO 1 — una tantum: il cliente con la tessera registra il proprio
// numero di tessera insieme al numero di telefono (pagina registra-tessera.html)
app.post("/api/registra-tessera", limitaRichieste, (req, res) => {
  const { tessera, telefono } = req.body;
  if (!tesseraValida(tessera) || !telefonoValido(telefono)) {
    return res.status(400).json({ errore: "tessera o numero di telefono non validi" });
  }
  registroTessere[tessera.trim()] = telefono.trim();
  res.json({ ok: true });
});

// PASSAGGIO 2 — ogni volta che avvia una lavatrice: il cliente con la
// tessera indica quale macchina ha avviato (pagina associa.html, es. da
// QR code attaccato su ogni lavatrice). Chi paga in contanti salta questo
// passaggio e quindi non riceverà mai l'SMS, solo lo stato sul sito.
app.post("/api/associa-macchina", limitaRichieste, (req, res) => {
  const { nome, tessera } = req.body;
  if (!statoMacchine[nome]) {
    return res.status(400).json({ errore: "macchina non trovata" });
  }
  if (!tesseraValida(tessera)) {
    return res.status(400).json({ errore: "tessera non valida" });
  }
  const telefono = registroTessere[tessera.trim()];
  if (!telefono) {
    return res.status(404).json({ errore: "tessera non registrata" });
  }
  statoMacchine[nome].telefono = telefono;
  res.json({ ok: true });
});

function inviaSms(numero, testo) {
  // DA COMPLETARE: qui va collegato il tuo gestore SMS
  // (es. Twilio, Skebby, o un altro provider italiano).
  // Per ora stampa solo un log, cosi puoi provare tutto il resto
  // del sistema prima di attivare l'invio vero.
  console.log(`[SMS a ${numero}] ${testo}`);
}

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`Server avviato su http://localhost:${PORTA}`);
});
