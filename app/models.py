from datetime import datetime
from .extensions import db

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, index=True)
    email = db.Column(db.String(120), unique=True, index=True)
    password_hash = db.Column(db.String(128))
    role = db.Column(db.String(20), default='SECRETARY') # ADMIN, SECRETARY, PROFESSIONAL, DEVELOPER
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)

    # Relationships
    professional = db.relationship('Professional', back_populates='user', uselist=False)

    def __repr__(self):
        return f'<User {self.username}>'

class Professional(db.Model):
    __tablename__ = 'professionals'

    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(64), nullable=False)
    last_name = db.Column(db.String(64), nullable=False)
    specialty = db.Column(db.String(64))
    registration_number = db.Column(db.String(32))
    email = db.Column(db.String(120))
    phone = db.Column(db.String(32))
    color = db.Column(db.String(64)) # Tailwind class or hex
    status = db.Column(db.String(20), default='active')

    # Link to User Account (Optional, one-to-one)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, unique=True)
    user = db.relationship('User', back_populates='professional')

    # Relationships
    appointments = db.relationship('Appointment', backref='professional', lazy='dynamic')

    def __repr__(self):
        return f'<Professional {self.first_name} {self.last_name}>'

class Patient(db.Model):
    __tablename__ = 'patients'

    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(64), nullable=False)
    last_name = db.Column(db.String(64), nullable=False)
    dni = db.Column(db.String(20), unique=True, index=True)
    email = db.Column(db.String(120))
    phone = db.Column(db.String(32))
    birth_date = db.Column(db.Date)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    appointments = db.relationship('Appointment', backref='patient', lazy='dynamic')

    def __repr__(self):
        return f'<Patient {self.first_name} {self.last_name}>'

class Appointment(db.Model):
    __tablename__ = 'appointments'

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patients.id'))
    professional_id = db.Column(db.Integer, db.ForeignKey('professionals.id'))
    
    date_time = db.Column(db.DateTime, nullable=False, index=True)
    status = db.Column(db.String(20), default='scheduled') # scheduled, confirmed, completed, cancelled, no_show
    type = db.Column(db.String(50)) # consulta, tratamiento, etc.
    notes = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<Appointment {self.id} - {self.date_time}>'
