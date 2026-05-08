export default function replaceUrl(url: string): string {
    if (typeof url !== 'string' || !url.trim()) return '';
    // 1. 取出 pathname：支持绝对 URL（http://host/oss/...）和相对路径（/oss/...）两种入参
    let pathname: string;
    try {
        pathname = new URL(url).pathname;
    } catch {
        // 不是合法的绝对 URL，按相对路径处理；剥掉 query/hash
        pathname = url.split('?')[0].split('#')[0];
        if (!pathname.startsWith('/')) pathname = '/' + pathname;
    }
    // 2. 循环剥离开头的 /oss 与 /smallImage，避免 /oss/oss/... 这类脏路径只剥一层
    while (/^\/(oss|smallImage)(\/|$)/.test(pathname)) {
        pathname = pathname.replace(/^\/(oss|smallImage)/, '');
    }
    return pathname;
}
