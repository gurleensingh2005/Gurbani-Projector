export const filterSpeechNoise = (spokenText: string): string => {
    const words = spokenText.toLowerCase().split(/\s+/);
    const noisePattern = /^(dha|tin|tun|dhin|da|ki|ta|na|ge|ne|ti)$/i;
    return words.filter(w => {
        if (noisePattern.test(w)) return false;
        if (w.length <= 1) return false;
        return true;
    }).join(" ");
};
