# Verified local stack

Last checked: 2026-07-30

| Component | Verified version |
| --- | --- |
| Z-Image Studio | 0.1.0 |
| ComfyUI | 0.28.0 |
| ComfyUI frontend | 1.47.10 |
| PyTorch | 2.13.0+cu130 |
| CUDA runtime | 13.0 |
| ComfyUI Python | 3.13.3 |
| Musubi training Python | 3.10 |
| GPU | NVIDIA GeForce RTX 5070, 12 GB |

The verified ComfyUI startup reports `cudaMallocAsync`, two-stream asynchronous weight offloading,
and pinned memory enabled. The desktop launcher adds only `--fast fp16_accumulation`; it does not
force FP16 model weights or enable the broad `--fast` option.

Update this file only after the production build, tests, and live smoke pass on the new stack.
