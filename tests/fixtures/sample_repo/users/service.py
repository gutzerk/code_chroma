"""User account management service."""
from shared.text_utils import slugify


class UserService:
    """Handles user account lifecycle."""

    def __init__(self):
        self._users = {}

    def create_user(self, name: str) -> str:
        """Create a new user and return their slug id."""
        user_id = slugify(name)
        self._users[user_id] = {"name": name}
        return user_id

    def get_user(self, user_id: str):
        """Look up a user by slug id."""
        return self._users.get(user_id)


def list_active_users(service: UserService) -> list:
    """Return slugs of all known users."""
    return list(service._users.keys())
