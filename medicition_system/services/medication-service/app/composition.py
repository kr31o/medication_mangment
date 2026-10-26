"""التركيبة الدوائية [قرار المستخدم]: متى يكون دواءان «بديلين» لبعضهما؟

البديل = نفس المواد الفعالة، ونفس كمية كل مادة، ونفس الشكل (حب، شراب…)، ونفس نوع التحرر
(عادي أو مديد: XR و SR و MR…). الاسم التجاري والشركة وحجم العلبة والسعر لا تدخل في المقارنة.

الكتالوج يكتب التركيبة في حقلين نصيين: generic_name للمواد (مفصولة بـ +) و strength
للكميات بنفس الترتيب (مفصولة بـ + أو /)، وقد تنتهي الكميات بـ «لكل كمية» مثل «/ 5 ml».
هنا نحوّل الحقلين والشكل إلى صيغة واحدة ثابتة:

    Paracetamol + Chlorzoxazone | 300 mg / 250 mg | CAPSULE
    Chlorzoxazone + Paracetamol | 250 mg / 300 mg | CAPSULE
        → CAPSULE|chlorzoxazone=250mg;paracetamol=300mg      (الاثنان نفس التركيبة)

قواعد الصيغة:
1. كل مادة مع كميتها، ثم تُرتَّب أبجديًا: ترتيب الكتابة لا يغيّر التركيبة.
2. الكتلة بالملغ: 1 g = 1000 mg، و 500 mcg = 0.5 mg. باقي الوحدات (IU و %) كما هي.
3. كمية بلا وحدة تأخذ وحدة التي بعدها: «20 + 10 + 200 mg» = 20 mg و 10 mg و 200 mg.
4. «لكل» في آخر النص (/ 5 ml، / g) يجعل الكمية تركيزًا يُقارن لكل 1 مل أو 1 غ:
   2.5 mg / 5 ml = 0.5 mg / ml، و 160 mg / 5 ml غير 120 mg / 5 ml.
5. نوع التحرر من الاسم التجاري أو العيار (Uni Metforal XR، Cardizem RR، «60 mg MR»): الحب المديد
   التحرر ليس بديلًا للعادي ولو بنفس الكمية. XR = ER، و Retard = RR = PR، والبقية كما هي.
6. أسماء المواد بلا فرق في حالة الأحرف والمسافات، و HCl = Hydrochloride. غير ذلك يجب أن
   يتطابق الاسم حرفيًا: الملح المختلف (Valerate مقابل Dipropionate) تركيبة مختلفة.

إن لم يمكن فهم النص (عدد الكميات لا يساوي عدد المواد مثلًا) تُقارن النصوص كما هي بعد
توحيد حالة الأحرف والمسافات، فلا يصير دواءان بديلين إلا إن تطابقا تمامًا.

ما يُخزَّن في medications.composition_key هو بصمة SHA-1 لهذه الصيغة (40 حرفًا) ليُبحث بها
بفهرس. تُحسب عند كل إضافة أو تعديل (models.py)، فالدواء الجديد يجد بدائله بلا ربط يدوي.
"""

from __future__ import annotations

import hashlib
import re
from decimal import Decimal, InvalidOperation

# وحدات الكتلة وكم ملغ في كل منها.
_MASS_IN_MG = {"mg": Decimal(1), "g": Decimal(1000), "mcg": Decimal("0.001")}
_UNIT_ALIASES = {
    "mg": "mg",
    "milligram": "mg",
    "milligrams": "mg",
    "g": "g",
    "gm": "g",
    "gram": "g",
    "grams": "g",
    "mcg": "mcg",
    "µg": "mcg",
    "μg": "mcg",
    "ug": "mcg",
    "microgram": "mcg",
    "micrograms": "mcg",
    "ml": "ml",
    "l": "l",
    "iu": "iu",
    "i.u.": "iu",
    "i.u": "iu",
    "%": "%",
    "unit": "unit",
    "units": "unit",
    "dose": "dose",
    "doses": "dose",
    "actuation": "dose",
    "puff": "dose",
    "drop": "drop",
    "drops": "drop",
}
# ما يصلح أن يكون «لكل» في آخر النص: حجم أو كتلة مستحضر أو جرعة، لا كمية مادة (mg، IU، %).
_PER_UNITS = {"ml", "l", "g", "dose", "drop"}
_NAME_ALIASES = {"hcl": "hydrochloride", "hbr": "hydrobromide"}
_TOKEN = re.compile(r"^(?P<num>\d[\d,]*(?:\.\d+)?)?\s*(?P<unit>[^\d\s][^\s]*)?$")


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _name(raw: str) -> str:
    words = _collapse(raw).casefold().strip(" .").split(" ")
    return " ".join(_NAME_ALIASES.get(word, word) for word in words)


def _number(raw: str) -> Decimal | None:
    # 100,000 = مئة ألف (فاصلة آلاف)، و 0,5 = نصف (فاصلة عشرية).
    text = raw.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", raw) else raw.replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _plain(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _tokens(strength: str) -> tuple[list[tuple[Decimal | None, str | None]], list[str]] | None:
    """«75 mg + 25 mg / 5 ml» ← ([(75, mg), (25, mg), (5, ml)], ["+", "/"])، أو None إن لم يُفهم."""
    pieces = re.split(r"\s*([+/])\s*", _collapse(strength).casefold())
    texts, separators = pieces[0::2], pieces[1::2]
    tokens = []
    for text in texts:
        match = _TOKEN.match(text.strip())
        if not match or not (match.group("num") or match.group("unit")):
            return None
        number = _number(match.group("num")) if match.group("num") else None
        if match.group("num") and number is None:
            return None
        unit = match.group("unit")
        if unit is not None:
            unit = _UNIT_ALIASES.get(unit)
            if unit is None:
                return None
        tokens.append((number, unit))
    return tokens, separators


# كلمات نوع التحرر في الاسم التجاري أو العيار، وما تعنيه.
_RELEASE = {
    "xr": "er", "er": "er", "sr": "sr", "mr": "mr", "cr": "cr", "la": "la", "pr": "pr",
    "rr": "pr", "retard": "pr", "chrono": "cr", "xl": "xl", "dr": "dr",
}
# وتُكتب أحيانًا بنقطة: M.R و S.R و R.R.
_RELEASE.update({f"{word[0]}.{word[1]}": kind for word, kind in list(_RELEASE.items()) if len(word) == 2})
_RELEASE_WORD = re.compile(r"(?<![\w.])(" + "|".join(re.escape(w) for w in sorted(_RELEASE, key=len, reverse=True)) + r")(?![\w])", re.IGNORECASE)


def _release(*texts: str) -> tuple[str | None, str]:
    """نوع التحرر من النصوص، والعيار بعد حذف كلمته منه."""
    found = None
    for text in texts[:-1]:
        match = _RELEASE_WORD.search(text or "")
        if match:
            found = _RELEASE[match.group(1).casefold()]
    strength = texts[-1] or ""
    match = _RELEASE_WORD.search(strength)
    if match:
        found = found or _RELEASE[match.group(1).casefold()]
        strength = _RELEASE_WORD.sub("", strength)
    return found, _collapse(strength)


def canonical(generic_name: str, strength: str, dosage_form: str, brand_name: str = "") -> str:
    """الصيغة الثابتة للتركيبة (انظر رأس الملف)."""
    form = (dosage_form or "").strip().upper()
    release, strength = _release(brand_name, strength)
    if release:
        form = f"{form}:{release}"
    names = [_name(part) for part in re.split(r"\s*\+\s*", generic_name or "") if part.strip()]
    fallback = f"{form}|text|{' + '.join(names)}|{_collapse(strength or '').casefold()}"
    parsed = _tokens(strength or "")
    if not names or parsed is None:
        return fallback
    tokens, separators = parsed

    per = None
    per_amount = Decimal(1)
    if len(tokens) == len(names) + 1 and separators and separators[-1] == "/" and tokens[-1][1] in _PER_UNITS:
        number, unit = tokens.pop()
        per_amount = number if number else Decimal(1)
        # التركيز لكل 1 مل (أو 1 غ): «2.5 mg / 5 ml» و «0.5 mg / ml» واحد.
        if unit == "l":
            unit, per_amount = "ml", per_amount * 1000
        per = f"1{unit}" if unit in ("ml", "g") else f"{_plain(per_amount)}{unit}"
        if unit not in ("ml", "g"):
            per_amount = Decimal(1)
    if len(tokens) != len(names) or any(number is None for number, _ in tokens):
        return fallback

    # كمية بلا وحدة تأخذ وحدة أقرب كمية بعدها لها وحدة.
    units: list[str | None] = [unit for _, unit in tokens]
    following = None
    for index in range(len(units) - 1, -1, -1):
        if units[index] is None:
            units[index] = following
        following = units[index]
    if any(unit is None or unit in _PER_UNITS - {"g"} for unit in units):
        return fallback

    amounts = []
    for (number, _), unit in zip(tokens, units):
        # % تركيز أصلًا، فلا يُقسم على «لكل».
        scale = per_amount if unit != "%" else Decimal(1)
        if unit in _MASS_IN_MG:
            amounts.append(f"{_plain(number * _MASS_IN_MG[unit] / scale)}mg")
        else:
            amounts.append(f"{_plain(number / scale)}{unit}")
    parts = ";".join(sorted(f"{name}={amount}" for name, amount in zip(names, amounts)))
    return f"{form}|{parts}" + (f"|per {per}" if per else "")


def composition_key(generic_name: str, strength: str, dosage_form: str, brand_name: str = "") -> str:
    """بصمة التركيبة: دواءان بنفس البصمة بديلان لبعضهما."""
    return hashlib.sha1(canonical(generic_name, strength, dosage_form, brand_name).encode("utf-8")).hexdigest()
