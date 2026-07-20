# MVSep - Separador de Audio para YouTube 🎵

Extensión de Chrome que separa el audio de YouTube en pistas **instrumental** y **vocal** usando la API de [mvsep.com](https://mvsep.com).

## ✨ Características

- **Separación en tiempo real** — Captura el audio del video de YouTube y lo separa en instrumental y vocal
- **Tres modos de escucha** — Alterna entre Original, Instrumental y Vocal con un solo clic
- **Panel flotante elegante** — Interfaz oscura que se integra perfectamente con YouTube
- **Atajo de teclado** — `Ctrl+Shift+S` para abrir/cerrar el panel
- **Descarga directa** — Descarga las pistas separadas en formato MP3
- **Control de volumen** — Ajusta el volumen de las pistas separadas
- **Botón en YouTube** — Acceso rápido desde la barra de controles del reproductor

## 🚀 Instalación

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa el **Modo de desarrollador** (esquina superior derecha)
3. Haz clic en **Cargar extensión sin empaquetar**
4. Selecciona la carpeta `chrome-extension` de este proyecto
5. ¡Listo! Verás el ícono de MVSep en la barra de extensiones

## 📖 Cómo usar

1. Abre cualquier video en **YouTube**
2. Haz clic en el botón 🎵 de la barra de controles de YouTube **O** presiona `Ctrl+Shift+S`
3. Haz clic en **Separar Audio**
4. Espera mientras se graba y procesa el audio (la grabación dura hasta 60 segundos)
5. ¡Escucha y alterna entre **Original**, **Instrumental** y **Vocal**!

## ⚙️ Configuración

La extensión viene con una API key preconfigurada. Si necesitas cambiarla:

1. Haz clic derecho en el ícono de MVSep y selecciona **Opciones**
2. O haz clic en el ícono para abrir el popup
3. Ingresa tu API key de mvsep.com
4. Haz clic en **Guardar**

## 🔧 Tecnologías

- **Manifest V3** — Última arquitectura de extensiones Chrome
- **tabCapture API** — Captura de audio del navegador
- **MediaRecorder API** — Grabación de audio en el cliente
- **mvsep.com API** — Separación de fuentes de audio (modelo Ensemble)
- **Offscreen Documents** — Procesamiento en segundo plano

## 📋 Notas

- La separación puede tomar entre 30 segundos y 2 minutos dependiendo de la duración del audio
- La extensión graba hasta 60 segundos de audio para procesar
- Las pistas separadas se descargan en formato MP3
- Compatible con todas las páginas de YouTube

## 🔗 Enlaces

- [mvsep.com](https://mvsep.com) — API de separación de audio
- [mvsep.com API Docs](https://mvsep.com/en/full_api) — Documentación completa de la API

---

Desarrollado con ❤️ para la comunidad
