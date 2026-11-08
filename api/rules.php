<?php
declare(strict_types=1);

final class ApiError extends RuntimeException
{
    public function __construct(public readonly int $httpStatus, string $message)
    {
        parent::__construct($message);
    }
}

function invalid(string $message = 'Dados inválidos.'): never
{
    throw new ApiError(422, $message);
}

function text(mixed $value, int $max, bool $required = true): string
{
    if (!is_string($value) || !preg_match('//u', $value) ||
        preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
        invalid();
    }
    $value = trim($value);
    $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : preg_match_all('/./us', $value);
    if ($length > $max || ($required && $value === '')) {
        invalid("Texto obrigatório ou maior que o limite de {$max} caracteres.");
    }
    return $value;
}

function integer(mixed $value, int $min, int $max): int
{
    if (!is_int($value) || $value < $min || $value > $max) {
        invalid();
    }
    return $value;
}

function cents(mixed $value): int
{
    if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) ||
        $value < 0.01 || $value > 1000000 ||
        abs($value * 100 - round($value * 100)) > 0.000001) {
        invalid('Informe um valor de 0,01 a 1.000.000,00, com até duas casas decimais.');
    }
    return (int) round($value * 100);
}

function validCover(mixed $value): string
{
    if ($value === '') {
        return '';
    }
    if (!is_string($value) || strlen($value) > 700000 ||
        !preg_match('~^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$~D', $value, $matches)) {
        invalid('A capa deve ser PNG, JPEG ou WebP de até 700.000 caracteres em base64.');
    }
    $bytes = base64_decode($matches[2], true);
    if ($bytes === false || base64_encode($bytes) !== $matches[2]) {
        invalid('Imagem inválida.');
    }
    $image = @getimagesizefromstring($bytes);
    $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
    if (!$image || ($image['mime'] ?? '') !== 'image/' . $matches[1] ||
        $mime !== $image['mime'] || $image[0] < 1 || $image[1] < 1 ||
        $image[0] > 10000 || $image[1] > 10000 || $image[0] * $image[1] > 4000000) {
        invalid('Imagem inválida ou dimensões excessivas.');
    }
    if (!function_exists('imagecreatefromstring')) {
        throw new RuntimeException('GD image validation extension unavailable.');
    }
    $decoded = @imagecreatefromstring($bytes);
    if ($decoded === false) {
        invalid('Imagem inválida.');
    }
    unset($decoded);
    return $value;
}

function campaignFields(mixed $data): array
{
    if (!is_array($data) || array_is_list($data)) {
        invalid();
    }
    $date = $data['date'] ?? null;
    if (!is_string($date) || ($date !== '' && (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $date, $m) ||
        !checkdate((int) $m[2], (int) $m[3], (int) $m[1])))) {
        invalid('Data inválida.');
    }
    return [
        'name' => text($data['name'] ?? null, 80),
        'desc' => text($data['desc'] ?? null, 300, false),
        'prize' => text($data['prize'] ?? null, 160),
        'price' => cents($data['price'] ?? null) / 100,
        'date' => $date,
        'count' => integer($data['count'] ?? null, 1, 1000),
        'minimum' => integer($data['minimum'] ?? 50, 0, 100),
        'cover' => validCover($data['cover'] ?? ''),
    ];
}

function settingsFields(mixed $data): array
{
    if (!is_array($data) || array_is_list($data)) {
        invalid();
    }
    $phone = $data['phone'] ?? null;
    if (!is_string($phone) || !preg_match('/^\d{0,15}$/D', $phone)) {
        invalid('Telefone inválido.');
    }
    return [
        'pixKey' => text($data['pixKey'] ?? null, 200),
        'organizer' => text($data['organizer'] ?? null, 100),
        'phone' => $phone,
        'rules' => text($data['rules'] ?? null, 10000),
        'message' => text($data['message'] ?? null, 5000),
        'hours' => integer($data['hours'] ?? null, 1, 168),
    ];
}

function reservationFields(array $data): array
{
    $numbers = $data['numbers'] ?? null;
    if (!is_array($numbers) || !array_is_list($numbers) || !$numbers || count($numbers) > 1000) {
        invalid('Selecione números válidos.');
    }
    foreach ($numbers as $number) {
        integer($number, 1, 1000);
    }
    if (count(array_unique($numbers, SORT_NUMERIC)) !== count($numbers)) {
        invalid('Números repetidos.');
    }
    sort($numbers, SORT_NUMERIC);
    $phone = $data['phone'] ?? null;
    if (!is_string($phone) || strlen($phone) > 40 || !preg_match('/^[0-9+ ().-]+$/D', $phone)) {
        invalid('Telefone inválido.');
    }
    $phone = preg_replace('/\D/', '', $phone);
    if (strlen($phone) < 10 || strlen($phone) > 15) {
        invalid('Informe um telefone de 10 a 15 dígitos.');
    }
    $request = $data['requestId'] ?? null;
    if (!is_string($request) || !preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $request)) {
        invalid('Identificador de tentativa inválido.');
    }
    return [
        'campaignId' => identifier($data['campaignId'] ?? null),
        'numbers' => $numbers,
        'name' => text($data['name'] ?? null, 80),
        'phone' => $phone,
        'expectedPrice' => cents($data['expectedPrice'] ?? null),
        'expectedHours' => integer($data['expectedHours'] ?? null, 1, 168),
        'requestId' => $request,
    ];
}

function identifier(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^[a-f0-9]{32}$/D', $value)) {
        invalid('Identificador inválido.');
    }
    return $value;
}

function passwordValue(mixed $value): string
{
    // 72 bytes avoids silent truncation with PASSWORD_DEFAULT's bcrypt.
    if (!is_string($value) || strlen($value) < 12 || strlen($value) > 72 ||
        str_contains($value, "\0") || !preg_match('//u', $value)) {
        invalid('A senha deve ter de 12 a 72 bytes.');
    }
    return $value;
}

function nowMillis(): int
{
    return (int) floor(microtime(true) * 1000);
}

function encode(array $data): string
{
    return json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function decode(string $data): array
{
    return json_decode($data, true, 512, JSON_THROW_ON_ERROR);
}

function defaultBackendSettings(): array
{
    return [
        'pixKey' => 'CHAVE-NAO-CONFIGURADA',
        'organizer' => 'Tatem',
        'phone' => '',
        'rules' => 'O organizador deve configurar as regras e verificar os requisitos legais antes de operar. Pagamentos e devoluções são manuais.',
        'message' => 'Olá! Pedido {pedido}, campanha {rifa}, números {numeros}, total {valor}. Envio manual de comprovante para conferência do organizador.',
        'hours' => 24,
    ];
}
