/**
 * EmbeddedKeyCodec — 发布期"密钥注入"的混淆编解码器（编码端/解码端共用同一份源码）。
 *
 * 用途：让发布器把 launcher_priv.pem / launcher_pub.pem 以**非明文**形式烧进
 *       Shiori.exe 与 ShioriCore.dll，于是发行包不必再携带任何 .pem 文件。
 *
 * 格式：PEM 的 UTF-8 字节按小端打包成 ulong 数组，逐字与 SplitMix64 密钥流异或。
 *       解码是纯逆运算：异或同一密钥流 → 还原字节 → 截断回原长。
 *
 * ⚠ 必须如实理解它的强度：这是**混淆**，不是加密。
 *   密钥流种子与载荷都躺在同一个二进制里，拿到 exe/dll 的人一定能还原出 PEM。
 *   它挡住的是 `strings` 抓取、资源查看器翻找、误把 .pem 打进发行包这几类
 *   低成本泄漏；它**不能**让"删掉二进制也拿不到密钥"成立。
 *   真要达到那个强度，只能改设计：发布期用一次性随机"包密钥"重新包裹各包 DEK，
 *   让二进制里只存在只对本次发行有效的密钥（详见 .workbuddy/memory 里的记录）。
 */

namespace ShioriKeying
{
    using System;

    /// <summary>PEM 载荷 &lt;-&gt; ulong 数组的混淆编解码。</summary>
    public static class EmbeddedKeyCodec
    {
        /// <summary>SplitMix64 的黄金比例增量。</summary>
        private const ulong Gamma = 0x9E3779B97F4A7C15UL;

        /// <summary>把明文载荷编码成混淆后的 ulong 数组（发布期调用）。</summary>
        public static ulong[] Encode(byte[] data, ulong seed)
        {
            if (data == null || data.Length == 0) return Array.Empty<ulong>();

            int words = (data.Length + 7) / 8;
            var w = new ulong[words];
            for (int i = 0; i < data.Length; i++)
                w[i >> 3] |= (ulong)data[i] << ((i & 7) * 8);

            ulong s = seed;
            for (int i = 0; i < words; i++) w[i] ^= Next(ref s);
            return w;
        }

        /// <summary>把混淆数组还原成原长明文（运行期调用）。</summary>
        public static byte[] Decode(ulong[] words, int length, ulong seed)
        {
            if (words == null || words.Length == 0 || length <= 0) return Array.Empty<byte>();

            var outp = new byte[length];
            ulong s = seed;
            for (int i = 0; i < words.Length; i++)
            {
                ulong v = words[i] ^ Next(ref s);
                int bas = i << 3;
                for (int j = 0; j < 8; j++)
                {
                    int k = bas + j;
                    if (k >= length) break;
                    outp[k] = (byte)(v >> (j * 8));
                }
            }
            return outp;
        }

        /// <summary>SplitMix64：递增种子并返回下一段密钥流。</summary>
        private static ulong Next(ref ulong s)
        {
            s += Gamma;
            ulong z = s;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }
    }
}
