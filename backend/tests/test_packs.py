import shutil

import pytest
import yaml

from backend.core.packs import PACKS_DIR, PackError, load_pack


def test_textile_pack_loads():
    pack = load_pack("manufacturing_textile")
    assert pack.config.currency == "usd"
    assert len(pack.catalog) >= 20
    assert pack.machine("L-07").model == "Picanol OMNIplus-i"
    assert pack.config.approval_rules[-1].max_total is None


@pytest.fixture
def pack_copy(tmp_path):
    shutil.copytree(PACKS_DIR / "manufacturing_textile", tmp_path / "p")
    return tmp_path


def _edit_yaml(root, fn):
    path = root / "p" / "pack.yaml"
    data = yaml.safe_load(path.read_text())
    fn(data)
    path.write_text(yaml.safe_dump(data))


def _load(root):
    return load_pack("p", packs_dir=root)


def test_missing_pack():
    with pytest.raises(PackError, match="not found"):
        load_pack("no_such_pack")


def test_typo_key_fails(pack_copy):
    _edit_yaml(pack_copy, lambda d: d["policy"].update(min_suplier_score=50))
    with pytest.raises(PackError, match="min_suplier_score"):
        _load(pack_copy)


def test_scoring_weights_must_sum_to_one(pack_copy):
    _edit_yaml(pack_copy, lambda d: d["scoring_weights"].update(defect_rate=0.9))
    with pytest.raises(PackError, match="sum to 1"):
        _load(pack_copy)


def test_urgency_weights_must_sum_to_one(pack_copy):
    _edit_yaml(pack_copy, lambda d: d["urgency_levels"]["line_down"].update(speed_weight=0.9))
    with pytest.raises(PackError, match="must equal 1"):
        _load(pack_copy)


def test_approval_rules_need_catch_all(pack_copy):
    _edit_yaml(pack_copy, lambda d: d["approval_rules"].pop())
    with pytest.raises(PackError, match="catch-all"):
        _load(pack_copy)


def test_approval_rules_must_increase(pack_copy):
    def swap(d):
        r = d["approval_rules"]
        r[0], r[1] = r[1], r[0]
    _edit_yaml(pack_copy, swap)
    with pytest.raises(PackError, match="strictly increasing"):
        _load(pack_copy)


def test_unknown_hook_fails(pack_copy):
    _edit_yaml(pack_copy, lambda d: d["hooks"].update(pre_search=["telepathy"]))
    with pytest.raises(PackError, match="telepathy"):
        _load(pack_copy)


def test_supplier_pricing_unknown_sku_fails(pack_copy):
    path = pack_copy / "p" / "suppliers.json"
    path.write_text(path.read_text().replace('"BRG-6205-2RS"', '"BRG-9999"', 1))
    with pytest.raises(PackError, match="BRG-9999"):
        _load(pack_copy)


def test_bad_json_fails(pack_copy):
    (pack_copy / "p" / "catalog.json").write_text("[{")
    with pytest.raises(PackError, match="could not parse"):
        _load(pack_copy)
