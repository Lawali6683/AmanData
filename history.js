<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Transaction History - AmanData</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
     <link rel="stylesheet" href="ui.css">
     
     
      <style>
        .btn-back {
  position: absolute;
  top: 20px;
  left: 20px;
  cursor: pointer;
}
    </style>
</head>
<body>
    
    
   <header>
            <button type="button" class="btn-back" id="btnBack" aria-label="Back" onclick="history.back()">
  <i class="fa-solid fa-arrow-left"></i>
</button>
            <img src="https://i.imgur.com/bNK9ccG.png" class="page-logo" alt="AmanData Logo">
            <span class="header-spacer"></span>
        </header>


    <div class="scene" id="scene">
        <div class="bg" id="bg"></div>
        <img src="image/logo.png" class="loader-logo" id="loaderLogo" alt="Logo">
        <div class="liquid" id="liquid">
            <div class="wave wave-1">
                <svg viewBox="0 0 1200 80" preserveAspectRatio="none">
                    <path d="M0,40 C200,80 400,0 600,40 C800,80 1000,0 1200,40 L1200,80 L0,80 Z"></path>
                </svg>
            </div>
            
            
            <div class="wave wave-2">
                <svg viewBox="0 0 1200 80" preserveAspectRatio="none">
                    <path d="M0,40 C200,80 400,0 600,40 C800,80 1000,0 1200,40 L1200,80 L0,80 Z"></path>
                </svg>
            </div>
        </div>
    </div>

    <div class="brand" id="brand">
        Loading<span class="bdot">.</span><span class="bdot">.</span><span class="bdot">.</span>
    </div>

    <div class="app-container" id="appContainer">
        

        <section class="summary-card">
            <div class="summary-label">Wallet Balance</div>
            <div class="summary-balance">₦<span id="sumBalance">0.00</span></div>
            <div class="summary-split">
                <div class="summary-box">
                    <span>Money Added</span>
                    <strong>₦<span id="sumIn">0.00</span></strong>
                </div>
                <div class="summary-box">
                    <span>Money Spent</span>
                    <strong>₦<span id="sumOut">0.00</span></strong>
                </div>
            </div>
        </section>

        <section class="filter-tabs">
            <button type="button" class="tab-btn active" id="tabWallet"><i class="fa-solid fa-wallet"></i> Wallet</button>
            <button type="button" class="tab-btn" id="tabPaid"><i class="fa-solid fa-building-columns"></i> Withdrawn</button>
            <button type="button" class="tab-btn" id="tabPending"><i class="fa-solid fa-hourglass-half"></i> Pending <span class="tab-badge" id="pendingBadge">0</span></button>
        </section>

        <main class="history-list" id="historyList"></main>
    </div>

    <div class="overlay-details" id="detailsOverlay">
        <div class="detail-card" role="dialog" aria-modal="true">
            <div class="detail-header">
                <h3 class="detail-header-title" id="detTitle">Transaction Receipt</h3>
                <button type="button" class="btn-close-detail" id="btnCloseDetails" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="detail-rows" id="detRows"></div>
        </div>
    </div>

    <div class="toast-container" id="toastContainer">
        <i class="fa-solid fa-circle-exclamation toast-icon"></i>
        <span class="toast-message" id="toastMessage">An error occurred</span>
    </div>

    <script type="module" src="history.js"></script>

    <script>
        setTimeout(function () {
            var scene = document.getElementById('scene');
            var app = document.getElementById('appContainer');
            if (scene && !scene.classList.contains('hidden')) {
                scene.classList.add('hidden');
                if (app) app.classList.add('ready');
            }
        }, 15000);
        
        document.getElementById('btnBack').addEventListener('click', function() {
  window.location.href = 'dashboard.html';
});
    </script>
</body>
</html>
