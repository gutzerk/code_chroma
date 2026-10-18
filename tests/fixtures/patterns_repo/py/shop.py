from abc import ABC, abstractmethod


class Pricer(ABC):
    @abstractmethod
    def price(self, item): ...


class Flat(Pricer):
    def price(self, item):
        return 1


class Tiered(Pricer):
    def price(self, item):
        return 2


class Cart:
    def total(self, pricer, item):
        return pricer.price(item)


class Config:
    _inst = None

    @classmethod
    def get(cls):
        if cls._inst is None:
            cls._inst = Config()
        return cls._inst


class Hub:
    handlers = {}

    def __init__(self):
        self.listeners = []

    def register(self, key, value):
        self.handlers[key] = value

    def subscribe(self, fn):
        self.listeners.append(fn)

    def emit(self):
        for fn in self.listeners:
            fn()


class Gateway:
    def run(self):
        self.auth.check()
        self.db.save()
        self.cache.drop()


class LegacyAdapter:
    def send(self, msg):
        self.client.post(msg)
