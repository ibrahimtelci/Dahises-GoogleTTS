@echo off
REM PostgreSQL 18 - ttsmerkez kumesini baslatir.
REM Zaten calisiyorsa hicbir sey yapmaz (idempotent).
setlocal
set PGBIN=C:\Program Files\PostgreSQL\18\bin
set PGDATA=C:\Users\ibrah\pgdata

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [pg] zaten calisiyor.
  exit /b 0
)

echo [pg] baslatiliyor...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -l "%PGDATA%\server.log" -w -t 60 start
exit /b %ERRORLEVEL%
