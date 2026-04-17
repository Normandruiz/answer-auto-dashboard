# Answer Seguros — Dashboard Auto

Reporte diario automatizado de performance publicitaria para el segmento **Auto** de Answer Seguros (Grupo Galicia).

**URL pública:** <https://normandruiz.github.io/answer-auto-dashboard/>

## Fuentes

- **Google Ads** — cuenta `185-655-0386`
- **Meta Ads** — cuenta `986890659698619`
- **Google Sheet interno** — volumen real de cotizaciones y ventas ecommerce

## Estado actual

Iteración 1 (MVP) — dashboard con datos mock embebidos + deploy GitHub Pages.

Próximas iteraciones: extractores reales (Playwright), merge, envío por email, Task Scheduler.

## Uso local

```bash
npm install
npm run build      # genera index.html desde data/mock.json
npm run serve      # sirve en http://localhost:8080
```

## Estructura

```
extract/     # scrapers (Playwright) — pendiente
process/     # merge + métricas cruzadas — pendiente
generate/    # template + builder (listo)
deploy/      # push a GitHub Pages (listo)
send/        # email (Nodemailer) — pendiente
data/        # JSONs por fecha
archive/     # snapshots HTML históricos
```
