from app.validators.common_validators import require_fields, validate_date_str, validate_int


def validate_dose_action(data: dict):
    require_fields(data, ["dose_time_id", "scheduled_date"])
    return {
        "dose_time_id": validate_int(data["dose_time_id"], "dose_time_id", minimum=1),
        "scheduled_date": validate_date_str(data["scheduled_date"], "scheduled_date"),
    }


validate_confirm_intake = validate_dose_action
validate_mark_missed = validate_dose_action
