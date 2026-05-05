from app.extensions import db


class BaseRepository:
    def __init__(self, model):
        self.model = model

    def get_by_id(self, record_id):
        return db.session.get(self.model, record_id)

    def get_all(self):
        return self.model.query.all()

    def save(self, instance):
        db.session.add(instance)
        db.session.commit()
        return instance

    def delete(self, instance):
        db.session.delete(instance)
        db.session.commit()

    def commit(self):
        db.session.commit()

    def rollback(self):
        db.session.rollback()
