@echo off
cd /d "C:\Users\Usuario\Desktop\Norman - Claude\answer-auto-dashboard"
node run.js --no-email >> logs\pipeline.log 2>&1
