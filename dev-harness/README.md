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
