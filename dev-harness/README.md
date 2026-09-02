# Banco de pruebas fuera de Obsidian

Carga main.js y styles.css compilados en Chrome con un sustituto minimo de la API de Obsidian (shim.js) y ejecuta escenarios con capturas.

```
npm run build
cd dev-harness && npm init -y && npm i puppeteer-core@22
node run2.mjs   # texto, paneles, marcadores, deshacer
node run3.mjs   # formas, goma, objetos, zoom, seleccion
node run4.mjs   # objetos insertados y paneles de herramientas
node run5.mjs   # linea recta con Shift, goma parcial, ancho automatico, Ctrl+A/D, flechas
```

Las capturas quedan en shots2/, shots3/ y shots4/.
node run6.mjs   # calculadora, LaTeX, cuadricula, interfaz compacta
node run7.mjs   # bloques de codigo: resaltado, Tab, cercas ```
node run8.mjs   # lazo, enlaces, busqueda Ctrl+F, ajustar vista, atajos
node run10.mjs  # notacion facil a LaTeX, etiquetas con resumen, nota flotante, calculadora y minimapa arrastrables
node run11.mjs  # grabadora con microfono simulado: MP3 guardado e insertado
node am-test.mjs  # conversor de notacion (requiere: npx esbuild ../src/asciimath.ts --format=esm --outfile=asciimath.mjs)
node run12.mjs  # minimapa con contenido, traductor flotante sobre la pizarra, dictado del sistema
node run13.mjs  # navegador de pizarras y notas, tarjetas de enlace a notas y pizarras
node run14.mjs  # tablas: bordes arrastrables e insertar/borrar; graficos de datos y de funciones
node run15.mjs  # X de cierre en objetos, OCR sobre una zona de la pizarra (Tesseract), pantalla completa
node run16.mjs  # listas y alineacion en texto, X en barra de formato, regla y marco de seleccion
node run17.mjs  # calculadora completa (porcentajes, unidades, variables, sumatorios, integrales, solve) y tablas sin encabezado forzado
node run18.mjs  # X en paneles flotantes y seleccion limpia con barra de acciones
node run19.mjs  # Ctrl+C/X/V de objetos y texto plano; fracciones en la calculadora
node run20.mjs  # recorrido con captura de cada utilidad (paneles, diálogos, marcadores, buscador, atajos)
node run21.mjs  # paneles al segundo clic, marcadores sin diálogo con renombrado en línea, bloque de código vacío se descarta, buscador bajo las etiquetas
node run22.mjs  # visor de PDF con X al borde, disposición en anchos de tablet y móvil con paneles abiertos
node video/music.mjs 62 && node video/record.mjs   # vídeo promocional: pista de audio sintetizada + fotogramas 1920x1080; luego ffmpeg (ver abajo)

Montaje del vídeo (desde dev-harness/video):
```
ffmpeg -y -framerate 24 -i frames/f%05d.jpg -i music.wav -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -vf "fade=t=in:st=0:d=0.6,fade=t=out:st=56.2:d=0.7" -c:a aac -b:a 192k -af "afade=t=out:st=54.5:d=2.4" -shortest -movflags +faststart ../../NoteLens-promo.mp4
```
node run23.mjs  # cinco tipos de trazo (bolígrafo, lápiz, pluma, rotulador, pincel), calculadora estilo Casio, X del visor PDF, disposición tablet/móvil (barra inferior y paneles como hojas)
node run24.mjs  # girar selecciones (asa y botones de 90°), renombrar tablas con doble clic, hover distinto por etiqueta
node run25.mjs  # notas flotantes escritas/dibujadas, tarjeta propia por etiqueta y tecla de fracción
node run26.mjs  # libreta multipágina, marcadores/resumen entre páginas, persistencia v10, X de gráficos/Markdown y responsive tablet
node run30.mjs  # pegado localizado dentro de etiquetas y margen independiente por página
node run31.mjs  # checklist de tareas, Ctrl+V realista en etiquetas y modal sin recortes
Los parches aplicados con Python están en patches/ (p8…p14) por si hay que rehacer un cambio.
node run26.mjs  # tareas: un clic marca un paso, tarjeta interactiva, botón para todos los pasos
node run27.mjs  # rejilla del panel de fondo, interruptor del margen, cursor por etiqueta, pasos escritos a mano
node run28.mjs  # filtros por página en el resumen de etiquetas y en los marcadores
node run29.mjs  # recorte del paso escrito a mano (el marco se ajusta) y posits con aspecto de papel
node run30.mjs  # mascota y chat con modelo local simulado (incluye el caso sin servidor)
node run31.mjs  # Canela: nombre, acciones en la pizarra (posit, LaTeX, tarea), dibujo y elección de modelo
node run32.mjs  # Leen: modelo multimodal por defecto según la RAM del equipo, y trazo a mano que no se sale de la tarjeta
node run33.mjs  # el dibujo se ve al tamaño en que se escribió, gato arrastrable y arranque del servidor desde el plugin
node run34.mjs  # nombre fijo, chat que sale de Leen en cualquier esquina e instalación de Ollama desde el plugin
node run35.mjs  # X visible, flecha hacia Leen, colocación que esquiva barras/minimapa y diagnóstico del servidor
node run36.mjs  # ajustes nuevos: ocultar a Leen, tamaño, bocadillos, contexto, servidor y valores por defecto
node run37.mjs  # 127.0.0.1 cuando localhost falla, X del chat y opciones de petición para el dibujo
node run38.mjs  # sello de compilación en los ajustes, acceso desde la pizarra y X del chat
node run39.mjs  # distingue servidor caído, servidor sin modelos y servidor con modelos
node run40.mjs  # ajustes que se aplican en caliente, X del chat como glifo y etiqueta del botón
node run41.mjs  # catálogo multimodal por RAM con selector, y paleta de LaTeX por grupos
node run42.mjs  # registro de pizarras para ajustes en vivo, X de glifo y OCR de pizarra a fórmula
node run43.mjs  # diálogo de ecuación a mano (estilo OneNote) detrás del botón de fórmula
node run45.mjs  # reconocimiento de fórmulas (Tesseract eng + PSM 7 + lista blanca ASCII)
node run46.mjs  # traducción con el modelo local, respaldo web y modo estrictamente local
