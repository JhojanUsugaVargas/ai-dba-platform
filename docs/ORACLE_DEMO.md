# Demo Oracle — estadísticas fuera de rango, validadas como *pending* antes de publicar

Segundo motor de la plataforma, sobre el mismo ciclo OBSERVE → ASSESS → ANALYZE → RECOMMEND → APPROVE → EXECUTE → VERIFY → AUDIT.
**Estado:** código completo y probado sin conexión (`npm run test:oracle-offline`). **Todavía no se ha ejecutado contra una base Oracle real**
(esta máquina solo tiene Instant Client). Hay que correrlo una vez en un laboratorio y ajustar lo que Oracle devuelva.

## El escenario (el que un DBA Oracle reconoce en segundos)

1. `ORDERS` tiene estadísticas tomadas cuando la fecha más nueva era `SYSDATE-3`.
2. La carga nocturna inserta 150.000 pedidos de las últimas 20 horas; nadie re-recolecta `ORDERS`.
3. El reporte filtra `ORDER_DATE >= TRUNC(SYSDATE)-1`: **predicado fuera de rango** (más allá de `HIGH_VALUE`).
   El CBO estima ~1 fila (E-Rows 1) y encuentra 150.000 (A-Rows): nested loops donde correspondía hash join.
4. `DBA_TAB_STATISTICS.STALE_STATS = 'YES'` y `DBA_TAB_MODIFICATIONS` lo confirman.

## Flujo de la demo (dos cambios, el estilo Oracle)

| Paso | Qué muestra | Evidencia |
|---|---|---|
| Assessment | Hallazgos: stale stats, E-Rows/A-Rows 150.000x, NOARCHIVELOG, sin RMAN, packs habilitados (INFO de licencia) | `DBA_TAB_STATISTICS`, `V$SQL_PLAN_STATISTICS_ALL` (lo mismo que `DISPLAY_CURSOR 'ALLSTATS LAST'`) |
| Cambio 1 `gather_pending_stats` (LOW) | Estadísticas nuevas en el área **pending** (`PUBLISH=FALSE`): la aplicación no ve nada | El probe se corre en una sesión aislada con `optimizer_use_pending_statistics=TRUE`; la verificación confirma *published statistics unchanged* |
| Re-assessment | Nuevo hallazgo *Validated pending statistics ready to publish* con plan y latencia medidos con las pendientes | Probe publicado vs probe con pendientes, plan hash de cada uno |
| Cambio 2 `publish_pending_stats` (LOW, **reversible**) | `PUBLISH_PENDING_STATS(no_invalidate=>FALSE)`; rollback real con `RESTORE_TABLE_STATS` al timestamp guardado en `DBA_MAINT_LOG` | Antes/después: E-Rows/A-Rows, latencia, plan hash |
| PDF | Informe de negocio del cambio 2 (el cambio 1 no genera informe: la aplicación aún no vio nada) | |

TOCTOU: después de aprobar, `npm run ora:tamper` (otro DBA recolecta `ORDERS`) → la ejecución se niega con *Preconditions changed*.

## Seguridad (mínimo privilegio real)

- `AIDBA_SHOP`: dueño de las tablas, **schema-only** (`NO AUTHENTICATION`, 18c+): nadie inicia sesión con él.
- `AIDBA_RO`: `CREATE SESSION` + `SELECT_CATALOG_ROLE` + `SELECT` sobre las 3 tablas (para los probes). Todo en `SET TRANSACTION READ ONLY`.
  La plataforma verifica contra `DBA_SYS_PRIVS` / `DBA_ROLE_PRIVS` / `DBA_TAB_PRIVS` que no tenga ANY, CREATE, DBA/RESOURCE ni grants de escritura; si los tiene, se niega a continuar.
- `AIDBA_EXEC`: solo `CREATE SESSION` + `EXECUTE ON AIDBA_SHOP.DBA_MAINT`. **Sin `ANALYZE ANY`, sin `SELECT` sobre datos.**
  `DBA_MAINT` es un paquete *definer rights* del dueño del esquema, con allow-list de tablas y `DBMS_ASSERT.SIMPLE_SQL_NAME`; cada llamada queda en `DBA_MAINT_LOG`.
- **Licenciamiento:** cero AWR/ASH/`DBA_HIST_*`/SQL Tuning Advisor. Si `CONTROL_MANAGEMENT_PACK_ACCESS` tiene los packs habilitados, la plataforma lo reporta como INFO para revisar licencias.
- El script de laboratorio se niega a correr sin `ORA_LAB_I_CONFIRM_NON_PRODUCTION=yes`, se niega en `CDB$ROOT` y nunca borra cuentas que no creó (marca `AIDBA_SHOP.AIDBA_LAB_MARKER`).

## Cómo correrlo

Necesitas un Oracle 19c/21c/23ai **de laboratorio** (por ejemplo Oracle Database Free 23ai, PDB `FREEPDB1`). En `.env`:

```
ORA_LAB_HOST=127.0.0.1
ORA_LAB_PORT=1521
ORA_LAB_SERVICE=FREEPDB1
ORA_LAB_ADMIN_USER=SYSTEM
ORA_LAB_ADMIN_PASSWORD=...           # solo lo usa scripts/oracle-lab.ts
ORA_LAB_I_CONFIRM_NON_PRODUCTION=yes
```

```powershell
npm run ora:setup      # crea cuentas, datos (≈2,15 M filas), paquete DBA_MAINT, genera ORA_AGENT_*_PASSWORD en .env
npm run ora:status     # STALE_STATS / pending por tabla (como AIDBA_RO)
npm run demo:reset     # limpia el store de la plataforma (y reinicia el laboratorio PostgreSQL)
npm start              # en la UI: Motor = Oracle Database → Conectar en modo SOLO LECTURA
```

## Lo que hay que validar en la primera corrida real (honesto)

1. **Magnitud de la regresión.** Con *adaptive plans* (12c+) el CBO puede cambiar de nested loops a hash join en tiempo de ejecución y
   atenuar la diferencia de latencia. La evidencia E-Rows/A-Rows sigue ahí, y el plan registra `IS_RESOLVED_ADAPTIVE_PLAN`. Si la latencia
   casi no cambia, el mensaje de la demo es la corrección de cardinalidad y el cambio de plan, no los milisegundos. No inventamos números.
2. **Statistics feedback.** Cada corrida del probe lleva un comentario único (hard parse nuevo) para que no se herede el feedback del cursor anterior.
3. **Maintenance window.** Si la tarea automática de estadísticas corre durante la demo, recolecta `ORDERS` y el escenario desaparece:
   `npm run ora:reset` lo recrea.
4. Privilegios en tu versión exacta: `ALTER SESSION SET optimizer_use_pending_statistics` sin privilegios extra y `V$SESSION_LONGOPS` vía `SELECT_CATALOG_ROLE`.
