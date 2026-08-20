@echo off
REM PostgreSQL 18 - ttsmerkez kumesini duzgun kapatir.
setlocal
set PGBIN=C:\Program Files\PostgreSQL\18\bin
set PGDATA=C:\Users\ibrah\pgdata
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -m fast -w -t 60 stop
exit /b %ERRORLEVEL%
