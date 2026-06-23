@echo off
echo =======================================
echo     Demarrage de l'EraGuesser
echo =======================================
echo.
cd /d "%~dp0"

echo [1/2] Ouverture de l'ecran principal...
start http://localhost:3000/display.html

echo [2/2] Lancement du serveur Node.js...
echo (Pour arreter le serveur, fermez cette fenetre ou faites Ctrl+C)
echo.
"C:\Program Files\nodejs\node.exe" server.js

pause
