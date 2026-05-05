from app.validators.common_validators import require_fields, validate_int, as_str


def validate_send_warning(data: dict):
    require_fields(data, ["patient_id", "title", "message"])
    return {
        "patient_id": validate_int(data["patient_id"], "patient_id", minimum=1),
        "title": as_str(data["title"], "title", max_len=200),
        "message": as_str(data["message"], "message"),
    }
