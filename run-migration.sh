#!/bin/bash

# Script para ejecutar la migración SQL en Railway
# Asegúrate de tener railway CLI instalado: npm i -g @railway/cli

echo "🚀 Ejecutando migración de base de datos en Railway..."

# Ejecutar el script SQL
railway run --service postgres psql -f prisma/migrations/manual_add_appointment_reminders.sql

echo "✅ Migración completada!"
echo ""
echo "Verifica que todo esté correcto ejecutando:"
echo "railway run --service postgres psql -c \"\\dt inventa_clinical_app.appointment_reminders\""
