"""Billing and invoicing service."""
from shared.text_utils import slugify


class BillingService:
    """Handles invoice creation for billed accounts."""

    def __init__(self):
        self._invoices = {}

    def create_invoice(self, account_name: str, amount: float) -> str:
        """Create an invoice for the named account."""
        invoice_id = slugify(account_name)
        self._invoices[invoice_id] = amount
        return invoice_id
