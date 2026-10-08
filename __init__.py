"""FluidMusic Hermes media plugin package."""

__all__ = ["__version__", "register"]
__version__ = "0.1.0"


def register(_ctx: object) -> None:
    """Provide the native plugin entry point; dashboard routes load separately."""
