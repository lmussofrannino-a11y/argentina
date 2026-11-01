# Migración de fotos y firmas del DNI a Cloudflare R2

La app puede guardar fotos y firmas nuevas en un bucket privado de R2. Las filas antiguas siguen funcionando desde Base64 hasta que se ejecute explícitamente la etapa de limpieza. Los objetos subidos a R2 no se borran desde la app ni desde el migrador.

## Configuración

1. Crear un bucket R2 con acceso privado y clase **Standard**. No habilitar un dominio público para este bucket.
2. Crear un token de API de R2 limitado a ese bucket, con lectura y escritura de objetos.
3. Agregar estas variables de entorno al entorno local (`.env.local`) y al proyecto de Vercel:

   ```text
   CLOUDFLARE_R2_ACCOUNT_ID=...
   CLOUDFLARE_R2_ACCESS_KEY_ID=...
   CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
   CLOUDFLARE_R2_BUCKET=...
   CLOUDFLARE_R2_WRITE_ENABLED=false
   ```

   Son secretos del servidor: no usar prefijo `NEXT_PUBLIC_`, no ponerlos en el navegador y no subirlos al repositorio.

4. Configurar CORS en el bucket para permitir `GET` desde el dominio de producción y `http://localhost:3000` para desarrollo. Por ejemplo:

   ```json
   [{
     "AllowedOrigins": ["https://TU-DOMINIO", "http://localhost:3000"],
     "AllowedMethods": ["GET"],
     "AllowedHeaders": ["*"],
     "ExposeHeaders": ["Content-Type", "Content-Length"],
     "MaxAgeSeconds": 3600
   }]
   ```

   La firma del DNI se carga en un canvas, por lo que el navegador necesita permiso CORS para leer esos bytes.
5. Desplegar la versión que incorpora `fotoStorageKey` y `firmaStorageKey`. El `build` de este proyecto ejecuta `prisma db push` para agregar esas columnas nullable, conservando los datos Base64 existentes.

Con `CLOUDFLARE_R2_WRITE_ENABLED=false`, la app mantiene compatibilidad y sigue guardando temporalmente las imágenes nuevas como Base64. Cuando el retrollenado esté verificado, cambiar esta variable a `true` y redeplegar para que los registros y cambios nuevos se suban a R2. La app verifica tamaño y checksum antes de guardar la clave en Neon.

## Migrar imágenes existentes

Primero crear un respaldo de Neon. Guardar `DATABASE_URL` en el archivo local ignorado `.env.migration.local` y las variables R2 en `.env.local`:

```powershell
npm run storage:migrate-dni-images -- --upload
```

Esta primera etapa copia las imágenes a R2, verifica cada objeto y guarda su clave en Neon. **Mantiene intactas las columnas Base64.** Se puede repetir: el migrador usa claves por hash, no duplica archivos iguales y omite filas que cambiaron durante la copia. Los errores se reportan al final sin limpiar el Base64 de esa imagen.

Repetir `--upload` hasta que el resultado muestre `pendingUploads: 0` y `errors: 0`. Luego activar `CLOUDFLARE_R2_WRITE_ENABLED=true` y redeplegar. Volver a ejecutar `--upload` para cubrir registros que se hayan creado durante el despliegue. Comprobar en la app que las imágenes existentes cargan desde R2. Después, para liberar almacenamiento de Neon, ejecutar explícitamente:

```powershell
npm run storage:migrate-dni-images -- --clear-inline --confirm
```

Antes de poner en `NULL` una copia Base64, el migrador vuelve a comprobar que en R2 existe el archivo con el mismo checksum y tamaño. **Solo borra el contenido Base64 de la fila; no elimina el objeto de R2.** Las claves quedan en Neon y la app sigue sirviendo las mismas imágenes mediante URLs firmadas de 10 minutos.

Para restaurar a Neon el Base64 desde R2 si se necesita volver al comportamiento anterior:

```powershell
npm run storage:migrate-dni-images -- --restore-inline --confirm
```

La restauración tampoco elimina archivos de R2. No existe ninguna llamada de borrado de objetos en el código de la app ni en este migrador.

## Consideraciones

- El migrador procesa cinco filas por lote para no cargar todo el contenido en memoria.
- Al actualizar una foto o firma se guarda un objeto con clave basada en el contenido. La versión previa permanece en R2; no se configura una regla de expiración automática.
- Las respuestas normales de login y perfil nunca incluyen imágenes. Mientras queden filas antiguas, el endpoint privado de imágenes entrega Base64 solo para esas filas; después de migrarlas entrega URLs firmadas de R2.
- La limpieza de las columnas reducirá los datos vivos de Neon, pero las métricas del proveedor pueden tardar en reflejarlo por el mantenimiento/reclamación de páginas de Postgres.
