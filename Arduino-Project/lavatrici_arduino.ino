/*
  L'ORSETTO LAVATORE — monitoraggio lavatrici
  Arduino Uno R4 WiFi

  COSA FA:
  - Legge, per ogni lavatrice, il segnale "avvio ciclo" che arriva
    dalla cassa (attraverso un relè/optoisolatore, MAI collegato diretto).
  - Appena rileva un avvio, fa partire un cronometro:
      9 kg  (A, B) -> 33 minuti
      14/18 kg (C, D) -> 36 minuti
  - Ogni pochi secondi manda lo stato di tutte le lavatrici al server
    (libera / in corso + minuti e secondi rimanenti).

  COSA DEVI CAMBIARE TU PRIMA DI CARICARLO:
  - WIFI_SSID, WIFI_PASS: la tua rete WiFi
  - SERVER_URL: l'indirizzo del server che riceve i dati (vedi server.js)
  - I pin PIN_A..PIN_D se colleghi i segnali a pin diversi
*/

#include <WiFiS3.h>

// ---------- DA MODIFICARE ----------
const char* WIFI_SSID = "NOME_DELLA_TUA_RETE";
const char* WIFI_PASS = "PASSWORD_DELLA_TUA_RETE";
const char* SERVER_HOST = "api.orsetto-lavatore.it";  // senza https://, solo il dominio
const int   SERVER_PORT = 443;                         // 443 se usi https, 80 se http
const char* SERVER_PATH = "/api/stato";
const char* CHIAVE_ARDUINO = "cambia-questa-chiave";  // deve essere identica a quella in server.js
// ------------------------------------

// Pin digitali collegati (tramite relè/optoisolatore) al segnale "avvio ciclo"
const int PIN_A = 2;   // Lavatrice 9 Kg - A
const int PIN_B = 3;   // Lavatrice 9 Kg - B
const int PIN_C = 4;   // Lavatrice 14 Kg - C
const int PIN_D = 5;   // Lavatrice 18 Kg - D

const unsigned long DURATA_9KG_SEC  = 33UL * 60UL;  // 1980 secondi
const unsigned long DURATA_1418_SEC = 36UL * 60UL;  // 2160 secondi
const unsigned long INTERVALLO_INVIO_MS = 10000;    // manda lo stato ogni 10 secondi

struct Lavatrice {
  const char* nome;
  int pin;
  unsigned long durataSec;
  unsigned long secondiRimanenti;   // 0 = libera
  int ultimoLettoPin;
};

Lavatrice macchine[4] = {
  { "Lavatrice 9 Kg - A",  PIN_A, DURATA_9KG_SEC,  0, LOW },
  { "Lavatrice 9 Kg - B",  PIN_B, DURATA_9KG_SEC,  0, LOW },
  { "Lavatrice 14 Kg - C", PIN_C, DURATA_1418_SEC, 0, LOW },
  { "Lavatrice 18 Kg - D", PIN_D, DURATA_1418_SEC, 0, LOW }
};

WiFiSSLClient client;
unsigned long ultimoTick = 0;
unsigned long ultimoInvio = 0;

void connettiWiFi() {
  Serial.print("Connessione a ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnesso, IP: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < 4; i++) {
    pinMode(macchine[i].pin, INPUT_PULLDOWN);
  }
  connettiWiFi();
  ultimoTick = millis();
  ultimoInvio = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connettiWiFi();
  }

  // Legge i pin: un fronte di salita (LOW -> HIGH) = "ciclo avviato"
  for (int i = 0; i < 4; i++) {
    int letto = digitalRead(macchine[i].pin);
    if (letto == HIGH && macchine[i].ultimoLettoPin == LOW) {
      macchine[i].secondiRimanenti = macchine[i].durataSec;
      Serial.print(macchine[i].nome);
      Serial.println(": ciclo avviato");
    }
    macchine[i].ultimoLettoPin = letto;
  }

  // Cronometro: scala di un secondo ogni secondo reale
  if (millis() - ultimoTick >= 1000) {
    ultimoTick = millis();
    for (int i = 0; i < 4; i++) {
      if (macchine[i].secondiRimanenti > 0) {
        macchine[i].secondiRimanenti--;
      }
    }
  }

  // Invia lo stato al server ogni INTERVALLO_INVIO_MS
  if (millis() - ultimoInvio >= INTERVALLO_INVIO_MS) {
    ultimoInvio = millis();
    inviaStato();
  }
}

void inviaStato() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Costruisce un JSON tipo:
  // {"macchine":[{"nome":"Lavatrice 9 Kg - A","secondi":1980}, ...]}
  String json = "{\"macchine\":[";
  for (int i = 0; i < 4; i++) {
    json += "{\"nome\":\"";
    json += macchine[i].nome;
    json += "\",\"secondi\":";
    json += macchine[i].secondiRimanenti;
    json += "}";
    if (i < 3) json += ",";
  }
  json += "]}";

  if (client.connect(SERVER_HOST, SERVER_PORT)) {
    client.println(String("POST ") + SERVER_PATH + " HTTP/1.1");
    client.println(String("Host: ") + SERVER_HOST);
    client.println("Content-Type: application/json");
    client.println(String("X-Chiave: ") + CHIAVE_ARDUINO);
    client.println("Connection: close");
    client.print("Content-Length: ");
    client.println(json.length());
    client.println();
    client.println(json);
    client.stop();
    Serial.println("Stato inviato");
  } else {
    Serial.println("Connessione al server fallita");
  }
}
