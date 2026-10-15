"""DeepSeek LLM 客户端（OpenAI 兼容接口）。

用于多智能体会诊的「解读」环节：LLM 仅负责把算法已经算出的硬数据
（CNN 置信度、PINN 残差、特征频率、知识库条目等）转述为自然语言，
不做任何数值判断或计算。

降级策略：
- 未配置 API Key、开启 mock 模式、或调用抛异常/超时，均返回 None，
  由调用方（各 Agent）回退到原有模板文案，保证会诊流程不中断。
"""
from __future__ import annotations

import logging

from app.config import settings

logger = logging.getLogger(__name__)


class LLMClient:
    """DeepSeek 兼容 OpenAI SDK 的轻量客户端（惰性初始化）。"""

    def __init__(self) -> None:
        self._client = None

    @property
    def available(self) -> bool:
        """是否可调用真实 LLM。"""
        return bool(settings.deepseek_api_key) and not settings.deepseek_mock

    def _get_client(self):
        """惰性构造 OpenAI 客户端。"""
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=settings.deepseek_api_key,
                base_url=settings.deepseek_base_url,
                timeout=20.0,
                max_retries=1,
            )
        return self._client

    def chat(self, system: str, prompt: str) -> str | None:
        """调用 DeepSeek 返回文本；失败或不可用返回 None（触发降级）。"""
        if not self.available:
            return None
        try:
            client = self._get_client()
            resp = client.chat.completions.create(
                model=settings.deepseek_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
            )
            content = resp.choices[0].message.content
            return content.strip() if content else None
        except Exception as exc:  # noqa: BLE001 — LLM 失败必须降级，不能抛出
            logger.warning("DeepSeek 调用失败，降级为模板：%s", exc)
            return None


llm_client = LLMClient()


__all__ = ["LLMClient", "llm_client"]