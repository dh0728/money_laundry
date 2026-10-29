"""Check the real notebook kernel before any large graph is opened."""
import sys


def check_sampling_backend(graph_mode):
    """Require a working pyg-lib, including disjoint sampling used by the control."""
    if graph_mode not in ("shared", "disjoint"):
        raise ValueError(graph_mode)
    import torch
    details = f"Python: {sys.executable}\nPyTorch: {torch.__version__} / CUDA: {torch.version.cuda}"
    try:
        import pyg_lib
    except (ImportError, OSError, RuntimeError) as error:
        raise RuntimeError(
            "현재 커널에서 pyg-lib를 불러오지 못했습니다.\n"
            "수정된 노트북을 다시 열고, 오류가 난 커널을 재시작한 뒤 위에서부터 실행하세요.\n"
            "프로젝트의 runtime_deps에는 PyTorch 2.10 / CUDA 12.6용 pyg-lib가 포함되어 있습니다.\n"
            + details + "\n원인: " + str(error)
        ) from error

    import torch_geometric
    from torch_geometric import typing
    if not typing.WITH_PYG_LIB:
        raise RuntimeError(
            "pyg-lib는 설치되어 있지만 PyG에 이전 '라이브러리 없음' 상태가 남아 있습니다.\n"
            "오류가 난 노트북의 커널을 재시작한 뒤 첫 셀부터 실행하세요.\n" + details
        )

    from torch_geometric.data import HeteroData
    from torch_geometric.loader import LinkNeighborLoader
    relation = ("node", "to", "node")
    data = HeteroData()
    data["node"].x = torch.ones(4, 1)
    data[relation].edge_index = torch.tensor([[0, 1, 2, 3, 0, 2], [1, 2, 3, 0, 2, 1]])
    # No changes to the training RNG or data; exercise the same native sampler API.
    with torch.random.fork_rng(devices=[]):
        torch.random.default_generator.manual_seed(42)
        loader = LinkNeighborLoader(
            data, num_neighbors=[50, 50],
            edge_label_index=(relation, data[relation].edge_index[:, :2]),
            batch_size=2, shuffle=False, num_workers=0, replace=False,
            subgraph_type="directional", disjoint=graph_mode == "disjoint",
        )
        try:
            batch = next(iter(loader))
        except (ImportError, OSError, RuntimeError) as error:
            raise RuntimeError("pyg-lib 로딩 후 실제 이웃 추출 검사에 실패했습니다.\n" + details) from error
    assert batch[relation].input_id.numel() == 2
    return {
        "python": sys.executable,
        "torch": torch.__version__,
        "torch_geometric": torch_geometric.__version__,
        "pyg_lib": pyg_lib.__version__,
        "pyg_lib_path": pyg_lib.__file__,
        "graph_mode": graph_mode,
        "sampling_check": "PASS",
    }
