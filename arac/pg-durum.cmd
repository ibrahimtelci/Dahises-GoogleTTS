@echo off
setlocal
set PGBIN=C:\Program Files\PostgreSQL\18\bin
set PGDATA=C:\Users\ibrah\pgdata
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status
