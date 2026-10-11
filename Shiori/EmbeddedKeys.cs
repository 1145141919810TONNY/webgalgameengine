/**
 * EmbeddedKeys（启动器侧）—— 对内提供"烧进 Shiori.exe 的发布密钥"。
 *
 * 启动器用注入的私钥解开 .sgd 的 DEK，因此发行目录里**不需要**再摆任何 .pem；
 * 公钥副本同时注入，供启动器自带的一键校检使用。
 *
 * 载荷由 ShioriSigner 在发布时写进 Generated/EmbeddedKeys.Payload.cs（该文件
 * 只在发布机上存在、不进版本库）。没有那个文件时 Load() 是空实现，
 * HasPrivateKey / HasPublicKey 恒为 false，HttpServer 自动回退到
 * plugin/、exe 同级、上一级、上一级/keys 这套 pem 发现顺序 —— 开发期行为不变。
 */

namespace ShioriCSharp
{
    using System;
    using System.Text;

    internal static partial class EmbeddedKeys
    {
        private static byte[]? _priv;
        private static byte[]? _pub;

        static EmbeddedKeys()
        {
            // Load() 由生成文件实现；未注入时为编译器移除的空调用。
            try { Load(); } catch { /* 载荷损坏时静默降级到 pem 发现 */ }
        }

        /// <summary>由发布期生成的 Generated/EmbeddedKeys.Payload.cs 实现。</summary>
        static partial void Load();

        /// <summary>exe 内是否有可用的注入私钥。</summary>
        internal static bool HasPrivateKey => _priv is { Length: > 0 };

        /// <summary>exe 内是否有可用的注入公钥。</summary>
        internal static bool HasPublicKey => _pub is { Length: > 0 };

        /// <summary>注入的私钥 PEM；未注入时为空串。</summary>
        internal static string PrivateKeyPem => DecodePem(_priv);

        /// <summary>注入的公钥 PEM；未注入时为空串。</summary>
        internal static string PublicKeyPem => DecodePem(_pub);

        /// <summary>字节还原为 PEM 字符串；注入源 .pem 可能带 UTF-8 BOM（EF BB BF），
        /// 而 RSA.ImportFromPem 不接受前导 U+FEFF，这里剥掉以兼容。</summary>
        private static string DecodePem(byte[]? b)
        {
            if (b is not { Length: > 0 }) return string.Empty;
            string s = Encoding.UTF8.GetString(b);
            return s.Length > 0 && s[0] == '\uFEFF' ? s.Substring(1) : s;
        }
    }
}
