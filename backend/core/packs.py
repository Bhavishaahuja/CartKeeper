"""Industry pack loader.

A pack is a folder of config + seed data that tells the core how an industry
buys things. The core never branches on industry; it only reads what the pack
declares. Anything malformed fails at load time with every problem listed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

PACKS_DIR = Path(__file__).resolve().parents[2] / "packs"

# Hooks the core knows how to run. A pack may only reference these.
KNOWN_HOOKS = {"pre_search": {"machine_compatibility"}}

WEIGHT_TOLERANCE = 1e-6


class PackError(Exception):
    """Raised when a pack is missing, malformed, or internally inconsistent."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class UrgencyLevel(_Strict):
    label: str
    speed_weight: float = Field(ge=0, le=1)
    price_weight: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _weights_sum_to_one(self):
        if abs(self.speed_weight + self.price_weight - 1) > WEIGHT_TOLERANCE:
            raise ValueError("speed_weight + price_weight must equal 1")
        return self


class ApprovalRule(_Strict):
    max_total: float | None = Field(default=None, gt=0)
    approver_role: str


class Policy(_Strict):
    approved_suppliers_only: bool
    min_supplier_score: float = Field(ge=0, le=100)
    blocked_categories: list[str] = []


class ScoringWeights(_Strict):
    on_time_rate: float = Field(ge=0, le=1)
    avg_days_late: float = Field(ge=0, le=1)
    defect_rate: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _weights_sum_to_one(self):
        total = self.on_time_rate + self.avg_days_late + self.defect_rate
        if abs(total - 1) > WEIGHT_TOLERANCE:
            raise ValueError(f"scoring weights must sum to 1, got {total:g}")
        return self


class PackConfig(_Strict):
    name: str
    currency: Literal["usd"]
    budget_scope: str
    urgency_levels: dict[str, UrgencyLevel] = Field(min_length=1)
    approval_rules: list[ApprovalRule] = Field(min_length=1)
    policy: Policy
    scoring_weights: ScoringWeights
    hooks: dict[str, list[str]] = {}

    @model_validator(mode="after")
    def _approval_rules_are_tiered(self):
        caps = [r.max_total for r in self.approval_rules]
        if caps[-1] is not None:
            raise ValueError("last approval rule must have max_total: null (catch-all)")
        bounded = caps[:-1]
        if None in bounded:
            raise ValueError("only the last approval rule may have max_total: null")
        if bounded != sorted(bounded) or len(set(bounded)) != len(bounded):
            raise ValueError("approval rule max_total values must be strictly increasing")
        return self

    @model_validator(mode="after")
    def _hooks_are_known(self):
        for stage, names in self.hooks.items():
            if stage not in KNOWN_HOOKS:
                raise ValueError(f"unknown hook stage {stage!r}")
            unknown = set(names) - KNOWN_HOOKS[stage]
            if unknown:
                raise ValueError(f"unknown {stage} hooks: {sorted(unknown)}")
        return self


class CatalogItem(_Strict):
    sku: str
    name: str
    category: str
    unit: str
    keywords: list[str] = []
    compatible_models: list[str] | None = None  # None = fits anything


class PriceEntry(_Strict):
    unit_price: float = Field(gt=0)
    lead_days: int = Field(ge=0)


class Supplier(_Strict):
    supplier_id: str
    name: str
    approved: bool
    categories: list[str]
    price_list: dict[str, PriceEntry]


class InventoryEntry(_Strict):
    on_hand: int = Field(ge=0)
    location: str


class Machine(_Strict):
    machine_id: str
    type: str
    model: str
    line: str


class Pack(_Strict):
    key: str
    config: PackConfig
    catalog: list[CatalogItem]
    suppliers: list[Supplier]
    machines: list[Machine]
    inventory: dict[str, InventoryEntry] = {}
    seed_history: Path | None = None  # optional module exposing generate(pack, ...)

    def item(self, sku: str) -> CatalogItem | None:
        return next((i for i in self.catalog if i.sku == sku), None)

    def supplier(self, supplier_id: str) -> Supplier | None:
        return next((s for s in self.suppliers if s.supplier_id == supplier_id), None)

    def machine(self, machine_id: str) -> Machine | None:
        return next((m for m in self.machines if m.machine_id == machine_id), None)


def _cross_check(pack: Pack) -> list[str]:
    problems = []
    skus = [i.sku for i in pack.catalog]
    for dup in {s for s in skus if skus.count(s) > 1}:
        problems.append(f"catalog: duplicate sku {dup!r}")
    sup_ids = [s.supplier_id for s in pack.suppliers]
    for dup in {s for s in sup_ids if sup_ids.count(s) > 1}:
        problems.append(f"suppliers: duplicate supplier_id {dup!r}")
    machine_ids = [m.machine_id for m in pack.machines]
    for dup in {m for m in machine_ids if machine_ids.count(m) > 1}:
        problems.append(f"machines: duplicate machine_id {dup!r}")

    by_sku = {i.sku: i for i in pack.catalog}
    for s in pack.suppliers:
        for sku in s.price_list:
            item = by_sku.get(sku)
            if item is None:
                problems.append(f"suppliers: {s.supplier_id} prices unknown sku {sku!r}")
            elif item.category not in s.categories:
                problems.append(
                    f"suppliers: {s.supplier_id} prices {sku!r} but doesn't list "
                    f"category {item.category!r}"
                )

    for sku in pack.inventory:
        if sku not in by_sku:
            problems.append(f"inventory: unknown sku {sku!r}")

    known_models = {m.model for m in pack.machines}
    for item in pack.catalog:
        for model in item.compatible_models or []:
            if model not in known_models:
                problems.append(f"catalog: {item.sku} references unknown machine model {model!r}")
    return problems


def _read(path: Path):
    if not path.exists():
        raise PackError(f"missing pack file: {path}")
    try:
        text = path.read_text()
        return yaml.safe_load(text) if path.suffix in {".yaml", ".yml"} else json.loads(text)
    except (yaml.YAMLError, json.JSONDecodeError) as e:
        raise PackError(f"could not parse {path}: {e}") from e


def load_pack(key: str, packs_dir: Path = PACKS_DIR) -> Pack:
    """Load and validate the pack in `packs_dir/key`. Raises PackError on any problem."""
    root = packs_dir / key
    if not root.is_dir():
        raise PackError(f"pack {key!r} not found in {packs_dir}")
    raw = {
        "key": key,
        "config": _read(root / "pack.yaml"),
        "catalog": _read(root / "catalog.json"),
        "suppliers": _read(root / "suppliers.json"),
        "machines": _read(root / "machines.json"),
    }
    if (root / "inventory.json").exists():
        raw["inventory"] = _read(root / "inventory.json")
    if (root / "seed_history.py").exists():
        raw["seed_history"] = root / "seed_history.py"
    try:
        pack = Pack.model_validate(raw)
    except ValidationError as e:
        lines = [f"  {'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors()]
        raise PackError(f"pack {key!r} is invalid:\n" + "\n".join(lines)) from None
    problems = _cross_check(pack)
    if problems:
        raise PackError(f"pack {key!r} is inconsistent:\n" + "\n".join(f"  {p}" for p in problems))
    return pack
