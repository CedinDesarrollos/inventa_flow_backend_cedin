import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

def create_app():
    app = Flask(__name__)
    
    # Configuración básica
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev_key_super_secreta')
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///cedin_manager.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # Habilitar CORS para permitir peticiones desde el Frontend (React)
    CORS(app)

    # Inicializar Base de Datos
    from .extensions import db, migrate
    db.init_app(app)
    migrate.init_app(app, db)
    
    # Importar modelos para que Alembic los detecte
    from . import models

    @app.route('/api/health')
    def health_check():
        return {"status": "ok", "message": "Cedin Manager API is running"}

    return app
