<?php
declare(strict_types=1);

require_once __DIR__ . '/rules.php';

final class TatemService
{
    private array $settings;
    private bool $admin = false;
    private int $now;

    public function __construct(
        private PDO $db,
        private string $ownerHash,
        private string $ip,
        private int $idleSeconds = 1800
    ) {
    }

    private function query(string $sql, array $values = []): PDOStatement
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($values);
        return $statement;
    }

    public function run(?array $input = null): array
    {
        $this->db->beginTransaction();
        try {
            $row = $this->query('SELECT settings FROM app_settings WHERE id = 1 FOR UPDATE')->fetch();
            if (!$row) {
                throw new RuntimeException('Installation required.');
            }
            $this->settings = decode($row['settings']);
            $this->now = nowMillis();
            $this->checkSession();
            $order = $input === null ? null : $this->dispatch($input);
            $state = $this->state();
            if ($order !== null) {
                $state['order'] = $order;
            }
            $this->db->commit();
            return $state;
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                // Authentication failures must preserve their durable rate-limit counters.
                if ($error instanceof ApiError && in_array($input['action'] ?? '', ['login', 'password-change'], true)) {
                    $this->db->commit();
                } else {
                    $this->db->rollBack();
                }
            }
            throw $error;
        }
    }

    private function checkSession(): void
    {
        $auth = $_SESSION['auth'] ?? null;
        if (!is_array($auth)) {
            return;
        }
        if ($this->now - ($auth['last'] ?? 0) > $this->idleSeconds * 1000) {
            $this->clearAuth();
            return;
        }
        $row = $this->query('SELECT auth_version FROM admins WHERE username = ?', [$auth['user'] ?? ''])->fetch();
        if (!$row || (int) $row['auth_version'] !== ($auth['version'] ?? null)) {
            $this->clearAuth();
            return;
        }
        $this->admin = true;
        $_SESSION['auth']['last'] = $this->now;
    }

    private function clearAuth(): void
    {
        unset($_SESSION['auth']);
        $this->admin = false;
        session_regenerate_id(true);
    }

    private function requireAdmin(): void
    {
        if (!$this->admin) {
            throw new ApiError(401, 'Entre como administrador.');
        }
    }

    private function dispatch(array $input): ?array
    {
        $action = $input['action'] ?? null;
        if (!is_string($action)) {
            invalid('Ação inválida.');
        }
        if ($action === 'login') {
            $this->login($input);
            return null;
        }
        if ($action === 'logout') {
            $this->clearAuth();
            return null;
        }
        if ($action === 'reserve') {
            return $this->reserve($input);
        }
        $this->requireAdmin();
        switch ($action) {
            case 'password-change':
                $this->changePassword($input);
                break;
            case 'campaign-save':
                $this->saveCampaign($input);
                break;
            case 'campaign-delete':
                $campaign = $this->campaign(identifier($input['id'] ?? null));
                if (isset($campaign['cancellation']) || $this->priceLocked($campaign)) {
                    throw new ApiError(409, 'Não é possível excluir uma campanha que já recebeu reservas ou foi cancelada.');
                }
                $this->query('DELETE FROM campaigns WHERE id = ?', [$campaign['id']]);
                break;
            case 'campaign-cancel':
                $campaign = $this->campaign(identifier($input['id'] ?? null));
                $this->active($campaign);
                if (($input['refundAcknowledged'] ?? null) !== true) {
                    invalid('É obrigatório assumir a responsabilidade pela devolução manual dos valores pagos.');
                }
                $campaign['cancellation'] = [
                    'reason' => text($input['reason'] ?? null, 1000),
                    'created' => $this->now,
                    'refundAcknowledged' => true,
                ];
                $this->query('UPDATE campaigns SET data = ? WHERE id = ?', [encode($campaign), $campaign['id']]);
                break;
            case 'orders-update':
                $this->updateOrders($input);
                break;
            case 'settings-save':
                $this->settings = settingsFields($input['settings'] ?? null);
                $this->query('UPDATE app_settings SET settings = ? WHERE id = 1', [encode($this->settings)]);
                break;
            default:
                throw new ApiError(400, 'Ação desconhecida.');
        }
        return null;
    }

    private function rateKeys(string $user): array
    {
        return [
            hash('sha256', 'ip:' . $this->ip) => 20,
            hash('sha256', 'account:' . strtolower($user)) => 5,
        ];
    }

    private function checkLimit(string $user): void
    {
        foreach ($this->rateKeys($user) as $key => $maximum) {
            $row = $this->query('SELECT blocked_until FROM login_limits WHERE identifier_hash = ?', [$key])->fetch();
            if ($row && (int) $row['blocked_until'] > $this->now) {
                throw new ApiError(429, 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.');
            }
        }
    }

    private function failure(string $user): never
    {
        foreach ($this->rateKeys($user) as $key => $maximum) {
            $row = $this->query('SELECT * FROM login_limits WHERE identifier_hash = ?', [$key])->fetch();
            $start = $row ? (int) $row['window_started'] : $this->now;
            $count = $row ? (int) $row['failures'] : 0;
            if ($this->now - $start >= 900000) {
                $start = $this->now;
                $count = 0;
            }
            $count++;
            $blocked = $count >= $maximum ? $this->now + 900000 : 0;
            if ($row) {
                $this->query('UPDATE login_limits SET window_started = ?, failures = ?, blocked_until = ? WHERE identifier_hash = ?',
                    [$start, $count, $blocked, $key]);
            } else {
                $this->query('INSERT INTO login_limits (identifier_hash, window_started, failures, blocked_until) VALUES (?, ?, ?, ?)',
                    [$key, $start, $count, $blocked]);
            }
        }
        $this->query('DELETE FROM login_limits WHERE window_started < ? AND blocked_until < ?', [$this->now - 604800000, $this->now]);
        throw new ApiError(401, 'Usuário ou senha inválidos.');
    }

    private function verifiedAdmin(string $user, mixed $password): array
    {
        if (!is_string($password) || strlen($password) > 72 || str_contains($password, "\0")) {
            invalid('Senha inválida.');
        }
        $this->checkLimit($user);
        $row = $this->query('SELECT username, password_hash, auth_version FROM admins WHERE username = ?', [$user])->fetch();
        $dummy = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi';
        if (!password_verify($password, $row['password_hash'] ?? $dummy) || !$row) {
            $this->failure($user);
        }
        $this->query('DELETE FROM login_limits WHERE identifier_hash = ?', [hash('sha256', 'account:' . strtolower($user))]);
        return $row;
    }

    private function login(array $input): void
    {
        $user = text($input['user'] ?? null, 80);
        $row = $this->verifiedAdmin($user, $input['password'] ?? null);
        if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
            $this->query('UPDATE admins SET password_hash = ? WHERE username = ?', [
                password_hash($input['password'], PASSWORD_DEFAULT), $row['username'],
            ]);
        }
        session_regenerate_id(true);
        $_SESSION['auth'] = ['user' => $row['username'], 'version' => (int) $row['auth_version'], 'last' => $this->now];
        $this->admin = true;
    }

    private function changePassword(array $input): void
    {
        $password = passwordValue($input['password'] ?? null);
        $user = $_SESSION['auth']['user'];
        $this->verifiedAdmin($user, $input['currentPassword'] ?? null);
        $this->query('UPDATE admins SET password_hash = ?, auth_version = auth_version + 1 WHERE username = ?',
            [password_hash($password, PASSWORD_DEFAULT), $user]);
        // Changing/recovering the password invalidates every existing admin session.
        $this->clearAuth();
    }

    private function campaign(string $id): array
    {
        $row = $this->query('SELECT data FROM campaigns WHERE id = ?', [$id])->fetch();
        if (!$row) {
            throw new ApiError(404, 'Campanha não encontrada.');
        }
        return decode($row['data']);
    }

    private function active(array $campaign): void
    {
        if (isset($campaign['cancellation'])) {
            throw new ApiError(409, 'Esta campanha foi cancelada. Não é possível reservar ou confirmar pagamentos.');
        }
    }

    private function priceLocked(array $campaign): bool
    {
        return ($campaign['priceLocked'] ?? false) ||
            (bool) $this->query('SELECT id FROM reservations WHERE campaign_id = ? LIMIT 1', [$campaign['id']])->fetch();
    }

    private function occupied(string $id): array
    {
        $taken = [];
        $rows = $this->query("SELECT data FROM reservations WHERE campaign_id = ? AND (status = 'sold' OR (status = 'reserved' AND expires > ?))",
            [$id, $this->now])->fetchAll();
        foreach ($rows as $row) {
            $order = decode($row['data']);
            foreach ($order['numbers'] as $number) {
                $taken[$number] = $order['status'];
            }
        }
        return $taken;
    }

    private function saveCampaign(array $input): void
    {
        $create = $input['create'] ?? null;
        if (!is_bool($create)) {
            invalid();
        }
        $updated = campaignFields($input['campaign'] ?? null);
        if ($create) {
            $updated['id'] = bin2hex(random_bytes(16));
            $updated['priceLocked'] = false;
            $this->query('INSERT INTO campaigns (id, data) VALUES (?, ?)', [$updated['id'], encode($updated)]);
            return;
        }
        $previous = $this->campaign(identifier($input['campaign']['id'] ?? null));
        $this->active($previous);
        $locked = $this->priceLocked($previous);
        if ($locked && cents($updated['price']) !== cents($previous['price'])) {
            throw new ApiError(409, 'O valor fica bloqueado desde a primeira reserva, mesmo expirada ou cancelada.');
        }
        foreach ($this->occupied($previous['id']) as $number => $status) {
            if ($number > $updated['count']) {
                throw new ApiError(409, 'Existem números reservados ou confirmados acima do novo limite.');
            }
        }
        $updated['id'] = $previous['id'];
        $updated['priceLocked'] = $locked;
        $this->query('UPDATE campaigns SET data = ? WHERE id = ?', [encode($updated), $updated['id']]);
    }

    private function reserve(array $input): array
    {
        $fields = reservationFields($input);
        $fingerprint = hash('sha256', encode($fields));
        $existing = $this->query('SELECT data, request_hash FROM reservations WHERE owner_hash = ? AND request_id = ?',
            [$this->ownerHash, $fields['requestId']])->fetch();
        if ($existing) {
            if (!hash_equals($existing['request_hash'], $fingerprint)) {
                throw new ApiError(409, 'Esta tentativa já foi utilizada com outros dados.');
            }
            $order = decode($existing['data']);
            $campaign = $this->campaign($order['campaign']);
            if (isset($campaign['cancellation'])) {
                $order['campaignCancellation'] = $campaign['cancellation'];
            }
            return $order;
        }
        if (in_array(strtoupper($this->settings['pixKey']), ['CHAVE-NAO-CONFIGURADA', 'CHAVE-DE-TESTE'], true)) {
            throw new ApiError(409, 'O organizador ainda não configurou a chave Pix.');
        }
        $campaign = $this->campaign($fields['campaignId']);
        $this->active($campaign);
        if ($fields['expectedPrice'] !== cents($campaign['price']) || $fields['expectedHours'] !== $this->settings['hours']) {
            throw new ApiError(409, 'O valor ou prazo mudou. Atualize a seleção antes de reservar.');
        }
        $taken = $this->occupied($campaign['id']);
        foreach ($fields['numbers'] as $number) {
            if ($number > $campaign['count']) {
                invalid('Número fora da capacidade da campanha.');
            }
            if (isset($taken[$number])) {
                throw new ApiError(409, 'Alguns números não estão mais disponíveis.');
            }
        }
        $this->query('UPDATE app_settings SET order_sequence = order_sequence + 1 WHERE id = 1');
        $sequence = (string) $this->query('SELECT order_sequence FROM app_settings WHERE id = 1')->fetchColumn();
        $order = [
            'id' => bin2hex(random_bytes(16)),
            'orderNumber' => str_pad($sequence, 6, '0', STR_PAD_LEFT),
            'campaign' => $campaign['id'],
            'campaignName' => $campaign['name'],
            'prize' => $campaign['prize'],
            'unitPrice' => $campaign['price'],
            'total' => count($fields['numbers']) * cents($campaign['price']) / 100,
            'numbers' => $fields['numbers'],
            'name' => $fields['name'],
            'phone' => $fields['phone'],
            'status' => 'reserved',
            'created' => $this->now,
            'expires' => $this->now + $this->settings['hours'] * 3600000,
        ];
        if (!$this->query('SELECT owner_hash FROM participants WHERE owner_hash = ?', [$this->ownerHash])->fetch()) {
            $this->query('INSERT INTO participants (owner_hash, created) VALUES (?, ?)', [$this->ownerHash, $this->now]);
        }
        $this->query('INSERT INTO reservations (id, owner_hash, request_id, request_hash, campaign_id, status, expires, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
            $order['id'], $this->ownerHash, $fields['requestId'], $fingerprint,
            $campaign['id'], $order['status'], $order['expires'], encode($order),
        ]);
        $campaign['priceLocked'] = true;
        $this->query('UPDATE campaigns SET data = ? WHERE id = ?', [encode($campaign), $campaign['id']]);
        return $order;
    }

    private function updateOrders(array $input): void
    {
        $ids = $input['ids'] ?? null;
        $status = $input['status'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || !$ids || count($ids) > 1000 ||
            !in_array($status, ['sold', 'cancelled'], true)) {
            invalid('Selecione de 1 a 1000 pedidos.');
        }
        foreach ($ids as $id) {
            identifier($id);
        }
        if (count(array_unique($ids)) !== count($ids)) {
            invalid('Pedidos repetidos.');
        }
        $orders = [];
        foreach ($ids as $id) {
            $row = $this->query('SELECT data FROM reservations WHERE id = ?', [$id])->fetch();
            if (!$row) {
                throw new ApiError(409, 'Pedido não encontrado. Atualize a seleção.');
            }
            $order = decode($row['data']);
            if ($order['status'] !== 'reserved' || ($status === 'sold' && $order['expires'] <= $this->now)) {
                throw new ApiError(409, 'A seleção contém pedidos expirados ou já processados.');
            }
            if ($status === 'sold') {
                $this->active($this->campaign($order['campaign']));
                $order['confirmed'] = $this->now;
            }
            $order['status'] = $status;
            $orders[] = $order;
        }
        foreach ($orders as $order) {
            $this->query('UPDATE reservations SET status = ?, data = ? WHERE id = ?', [$status, encode($order), $order['id']]);
        }
    }

    private function state(): array
    {
        $campaigns = [];
        foreach ($this->query('SELECT data FROM campaigns ORDER BY id')->fetchAll() as $row) {
            $campaign = decode($row['data']);
            $campaigns[$campaign['id']] = $campaign;
        }
        $own = [];
        $visible = [];
        $ownCampaigns = [];
        $occupancy = [];
        foreach ($this->query('SELECT owner_hash, data FROM reservations ORDER BY id')->fetchAll() as $row) {
            $order = decode($row['data']);
            $campaign = $campaigns[$order['campaign']];
            if (isset($campaign['cancellation'])) {
                $order['campaignCancellation'] = $campaign['cancellation'];
            } elseif ($order['status'] === 'sold' || ($order['status'] === 'reserved' && $order['expires'] > $this->now)) {
                foreach ($order['numbers'] as $number) {
                    $occupancy[] = ['campaign' => $order['campaign'], 'number' => $number, 'status' => $order['status']];
                }
            }
            $isOwner = hash_equals($this->ownerHash, $row['owner_hash']);
            if ($isOwner) {
                $own[] = $order['id'];
                $ownCampaigns[$order['campaign']] = true;
            }
            if ($this->admin || $isOwner) {
                $visible[] = $order;
            }
        }
        return [
            'campaigns' => array_values(array_filter($campaigns, fn(array $campaign): bool =>
                $this->admin || !isset($campaign['cancellation']) || isset($ownCampaigns[$campaign['id']]))),
            'reservations' => $visible,
            'settings' => $this->settings,
            'occupancy' => $occupancy,
            'admin' => $this->admin,
            'csrf' => $_SESSION['csrf'],
            'ownOrderIds' => $own,
            'serverNow' => $this->now,
        ];
    }
}
