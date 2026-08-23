# Voice Engine V2

## Arquitectura

- `src/parser.js` segmenta el texto, reconoce cantidad/unidad y consulta el
  catalogo.
- `src/voice-engine.js` aplica comandos sobre las lineas existentes y mantiene
  contexto conversacional.
- `product_alias_learning` conserva correcciones por organizacion bajo RLS.
- `settings.voiceAliases` mantiene una copia offline por usuario y organizacion.

No se almacena audio. Solo se conserva la transcripcion dentro de la
requisicion para trazabilidad.

## Cantidades

El parser acepta digitos, numeros en palabras, decimales con punto o coma y las
fracciones `medio`, `un cuarto`, `tres cuartos` y `1/2`. Tambien interpreta
`kilo y medio`. Nunca convierte una unidad a otra.

Cuando la unidad se toma del catalogo, la linea queda marcada con
`unitInferred`. Una unidad explicita no permitida obliga revision.

## Confianza

- Alta: 90 a 100.
- Media: 70 a 89.
- Revision obligatoria: menos de 70 o una ambiguedad relevante.

Las ambiguedades muestran hasta tres sugerencias. La correccion elegida se
aprende como alias, pero no modifica silenciosamente el catalogo maestro.

## Comandos

Se aplican de forma real:

- quitar un producto;
- borrar el ultimo;
- cambiar cantidad y unidad;
- sumar una cantidad;
- duplicar una linea;
- deshacer la ultima accion;
- referencias como `mejor pongale doce` y `y otros tres`.

Si no existe una referencia suficientemente clara, el motor no modifica el
pedido y muestra un mensaje de revision.

## Dataset

`tests/voice-dataset.mjs` contiene 177 casos controlados. La prueba
`tools/voice-dataset.mjs` informa accuracy total y por categoria, y falla el
build si baja de 95 %. Resultado de Fase 5: 177/177 (100 %).

Este porcentaje describe el dataset versionado, no garantiza la misma precision
acustica de cada navegador o entorno de cocina.
